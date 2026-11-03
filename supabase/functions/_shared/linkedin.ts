import type { AdminClient } from "./supabase.ts";

const API_BASE = "https://api.linkedin.com";
const TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";

export const LINKEDIN_VERSION = Deno.env.get("LINKEDIN_VERSION") ?? "202610";

export type LinkedInErrorKind =
  | "not_connected"
  | "token_expired"
  | "permission"
  | "rate_limit"
  | "invalid"
  | "transient"
  | "uncertain"
  | "media"
  | "unknown";

export class LinkedInError extends Error {
  kind: LinkedInErrorKind;
  status: number;
  retryable: boolean;
  uncertain: boolean;
  retryAfterMs?: number;

  constructor(
    message: string,
    options: {
      kind: LinkedInErrorKind;
      status?: number;
      retryable?: boolean;
      uncertain?: boolean;
      retryAfterMs?: number;
    },
  ) {
    super(message);
    this.name = "LinkedInError";
    this.kind = options.kind;
    this.status = options.status ?? 0;
    this.retryable = options.retryable ?? false;
    this.uncertain = options.uncertain ?? false;
    this.retryAfterMs = options.retryAfterMs;
  }
}

type Tokens = {
  access_token: string;
  refresh_token?: string | null;
  expires_at?: string | null;
  scope?: string | null;
};

type SettingsRow = {
  linkedin_member_id: string | null;
  linkedin_member_name: string | null;
  linkedin_connected: boolean;
  linkedin_token_expires_at: string | null;
  linkedin_scopes: string[] | null;
  media_retention_hours: number | null;
};

export type PublishingIdentity = {
  accessToken: string;
  memberUrn: string;
  settings: SettingsRow;
};

function authHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    "LinkedIn-Version": LINKEDIN_VERSION,
    "X-Restli-Protocol-Version": "2.0.0",
  };
}

async function readError(res: Response): Promise<{ message: string; retryAfterMs?: number }> {
  const text = await res.text().catch(() => "");
  let message = text.slice(0, 800);

  try {
    const parsed = JSON.parse(text) as { message?: string; error?: string; serviceErrorCode?: number };
    message = parsed.message ?? parsed.error ?? message;
    if (parsed.serviceErrorCode) message = `${message} (service error ${parsed.serviceErrorCode})`;
  } catch {
    // Keep the raw text.
  }

  const retryAfter = res.headers.get("retry-after");
  let retryAfterMs: number | undefined;
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds > 0) retryAfterMs = seconds * 1000;
    else {
      const date = Date.parse(retryAfter);
      if (Number.isFinite(date)) retryAfterMs = Math.max(1000, date - Date.now());
    }
  }

  return { message: message || `LinkedIn responded with ${res.status}`, retryAfterMs };
}

function classify(res: Response, phase: "media" | "post"): LinkedInError {
  const status = res.status;
  const retryAfterMs = res.headers.get("retry-after")
    ? Number(res.headers.get("retry-after")) > 0
      ? Number(res.headers.get("retry-after")) * 1000
      : undefined
    : undefined;
  const base = { status, retryAfterMs };

  if (status === 401) {
    return new LinkedInError("LinkedIn rejected the access token. Reconnect your LinkedIn account.", {
      ...base,
      kind: "token_expired",
    });
  }

  if (status === 403) {
    return new LinkedInError(
      "LinkedIn denied this request for this destination. Check that the app has the scope and product approval the destination needs: w_member_social for personal profiles, w_organization_social (Community Management API) for Company and Showcase Pages.",
      { ...base, kind: "permission" },
    );
  }

  if (status === 429) {
    return new LinkedInError("LinkedIn rate limit reached. The post will retry with backoff.", {
      ...base,
      kind: "rate_limit",
      retryable: true,
    });
  }

  if (status === 409) {
    return new LinkedInError(
      "LinkedIn reported a write conflict. The previous attempt may have succeeded; verify on LinkedIn before retrying.",
      { ...base, kind: "uncertain", uncertain: true },
    );
  }

  if (status >= 500 || status === 408 || status === 425) {
    return new LinkedInError(
      phase === "post"
        ? "LinkedIn returned a server error. The post may or may not have been created."
        : "LinkedIn media upload failed temporarily.",
      {
        ...base,
        kind: phase === "post" ? "uncertain" : "transient",
        retryable: true,
        uncertain: phase === "post",
      },
    );
  }

  return new LinkedInError(
    `LinkedIn rejected the ${phase === "post" ? "post" : "media upload"} (HTTP ${status}).`,
    { ...base, kind: "invalid" },
  );
}

async function rpcJson<T>(admin: AdminClient, name: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await admin.rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}

async function getSettings(admin: AdminClient): Promise<SettingsRow> {
  const { data, error } = await admin
    .from("settings")
    .select(
      "linkedin_member_id, linkedin_member_name, linkedin_connected, linkedin_token_expires_at, linkedin_scopes, media_retention_hours",
    )
    .eq("id", 1)
    .maybeSingle();

  if (error) throw new Error(`Could not read settings: ${error.message}`);
  if (!data) throw new LinkedInError("Settings row is missing.", { kind: "not_connected" });
  return data as SettingsRow;
}

export async function getConnectionStatus(admin: AdminClient): Promise<{
  connected: boolean;
  memberId: string | null;
  settings: SettingsRow;
}> {
  const settings = await getSettings(admin);
  return {
    connected: settings.linkedin_connected && Boolean(settings.linkedin_member_id),
    memberId: settings.linkedin_member_id,
    settings,
  };
}

export async function getPublishingIdentity(
  admin: AdminClient,
  accountUrn?: string | null,
): Promise<PublishingIdentity> {
  const settings = await getSettings(admin);
  const target = accountUrn?.trim() || null;
  const primaryUrn = settings.linkedin_member_id
    ? `urn:li:person:${settings.linkedin_member_id.replace(/^urn:li:person:/, "")}`
    : null;

  let tokens: Tokens | null = null;

  if (target) {
    // A destination always publishes with its own account's token. Falling back
    // to another profile's token would post as the wrong author, so a missing
    // token fails only this job.
    tokens = await rpcJson<Tokens | null>(admin, "admin_get_account_tokens", {
      p_member_urn: target,
    }).catch(() => null);

    if (!tokens?.access_token) {
      throw new LinkedInError(
        "No LinkedIn access token is stored for this destination's account. Reconnect that account in Settings.",
        { kind: "not_connected" },
      );
    }
  } else {
    if (primaryUrn) {
      tokens = await rpcJson<Tokens | null>(admin, "admin_get_account_tokens", {
        p_member_urn: primaryUrn,
      }).catch(() => null);
    }

    if (!tokens?.access_token) {
      tokens = await rpcJson<Tokens | null>(admin, "admin_get_linkedin_tokens").catch(() => null);
    }

    if (!tokens?.access_token) {
      throw new LinkedInError("No LinkedIn access token is stored. Reconnect your account.", {
        kind: "not_connected",
      });
    }
  }

  let accessToken = tokens.access_token;
  const expiresAt = tokens.expires_at ? Date.parse(tokens.expires_at) : null;

  if (expiresAt && expiresAt < Date.now() + 120_000) {
    accessToken = await refreshAccessToken(admin, tokens, target, primaryUrn);
  }

  const memberUrn = target ?? primaryUrn;
  if (!memberUrn) {
    throw new LinkedInError("LinkedIn is not connected. Reconnect your account.", {
      kind: "not_connected",
    });
  }

  return {
    accessToken,
    memberUrn,
    settings,
  };
}

async function refreshAccessToken(
  admin: AdminClient,
  tokens: Tokens,
  accountUrn?: string | null,
  primaryUrn?: string | null,
): Promise<string> {
  const clientId = Deno.env.get("LINKEDIN_CLIENT_ID");
  const clientSecret = Deno.env.get("LINKEDIN_CLIENT_SECRET");

  if (!tokens.refresh_token) {
    await markConnectionError(
      admin,
      "Access token expired and no refresh token is available. Reconnect LinkedIn.",
      accountUrn,
      primaryUrn,
    );
    throw new LinkedInError(
      "LinkedIn access token expired. Reconnect your account from Settings.",
      { kind: "token_expired" },
    );
  }

  if (!clientId || !clientSecret) {
    throw new LinkedInError(
      "LinkedIn client credentials are missing from the Edge Function environment, so the token cannot be refreshed.",
      { kind: "token_expired" },
    );
  }

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
      client_id: clientId,
      client_secret: clientSecret,
    }),
    signal: AbortSignal.timeout(20_000),
  }).catch((error) => {
    throw new LinkedInError(
      `LinkedIn token refresh could not reach LinkedIn: ${
        error instanceof Error ? error.message : "network error"
      }`,
      { kind: "transient", retryable: true },
    );
  });

  if (!response.ok) {
    const detail = await readError(response);
    await markConnectionError(
      admin,
      `LinkedIn token refresh failed: ${detail.message}. Reconnect your account.`,
      accountUrn,
      primaryUrn,
    );
    throw new LinkedInError(
      "LinkedIn token refresh failed. Reconnect your account from Settings.",
      { kind: "token_expired", status: response.status },
    );
  }

  const refreshed = (await response.json()) as {
    access_token: string;
    expires_in?: number;
    refresh_token?: string;
    scope?: string;
  };

  const expiresAt = refreshed.expires_in
    ? new Date(Date.now() + refreshed.expires_in * 1000).toISOString()
    : null;
  const scopes = (refreshed.scope ?? tokens.scope ?? "").split(/[\s,]+/).filter(Boolean);

  if (accountUrn) {
    await rpcJson(admin, "admin_store_account_tokens", {
      p_member_urn: accountUrn,
      p_access_token: refreshed.access_token,
      p_refresh_token: refreshed.refresh_token ?? tokens.refresh_token,
      p_expires_at: expiresAt,
      p_scope: refreshed.scope ?? tokens.scope ?? null,
    });

    await admin
      .from("linkedin_accounts")
      .update({
        token_expires_at: expiresAt,
        scopes,
        status: "connected",
        last_error: null,
      })
      .eq("member_urn", accountUrn);
  } else {
    await rpcJson(admin, "admin_store_linkedin_tokens", {
      p_access_token: refreshed.access_token,
      p_refresh_token: refreshed.refresh_token ?? tokens.refresh_token,
      p_expires_at: expiresAt,
      p_scope: refreshed.scope ?? tokens.scope ?? null,
    });
  }

  // Only the primary account owns the settings row; refreshing a secondary
  // profile must not overwrite the primary's displayed session state.
  const isPrimary = !accountUrn || (primaryUrn !== null && primaryUrn === accountUrn);
  if (isPrimary) {
    await admin
      .from("settings")
      .update({
        linkedin_connected: true,
        linkedin_token_expires_at: expiresAt,
        linkedin_last_error: null,
        linkedin_scopes: scopes,
      })
      .eq("id", 1);
  }

  return refreshed.access_token;
}

export async function markConnectionError(
  admin: AdminClient,
  message: string,
  accountUrn?: string | null,
  primaryUrn?: string | null,
): Promise<void> {
  if (accountUrn) {
    await admin
      .from("linkedin_accounts")
      .update({ status: "expired", last_error: message })
      .eq("member_urn", accountUrn);
  }

  const isPrimary = !accountUrn || (primaryUrn !== null && primaryUrn === accountUrn);
  if (isPrimary) {
    await admin
      .from("settings")
      .update({ linkedin_last_error: message })
      .eq("id", 1);
  }
}

function mediaContentType(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

/**
 * Uploads one private Supabase Storage object through LinkedIn's Images API
 * and returns its image URN. Safe to retry: no post is created here.
 *
 * Images are owned by the publishing author, so each destination job uploads
 * its own assets with the author URN (member or organization).
 */
export async function uploadImageToLinkedIn(
  admin: AdminClient,
  accessToken: string,
  ownerUrn: string,
  path: string,
): Promise<string> {
  const { data: file, error } = await admin.storage.from("media").download(path);

  if (error || !file) {
    throw new LinkedInError(`Uploaded media could not be read from storage: ${path}`, {
      kind: "media",
      status: 404,
    });
  }

  const initResponse = await fetch(`${API_BASE}/rest/images?action=initializeUpload`, {
    method: "POST",
    headers: { ...authHeaders(accessToken), "Content-Type": "application/json" },
    body: JSON.stringify({ initializeUploadRequest: { owner: ownerUrn } }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!initResponse.ok) {
    const detail = await readError(initResponse);
    const error = classify(initResponse, "media");
    throw new LinkedInError(detail.message, {
      kind: error.kind,
      status: error.status,
      retryable: error.retryable,
      retryAfterMs: detail.retryAfterMs ?? error.retryAfterMs,
    });
  }

  const initialized = (await initResponse.json()) as {
    value?: { uploadUrl?: string; image?: string; uploadUrlExpiresAt?: number };
  };

  const uploadUrl = initialized.value?.uploadUrl;
  const imageUrn = initialized.value?.image;
  if (!uploadUrl || !imageUrn) {
    throw new LinkedInError("LinkedIn did not return an upload URL for the image.", {
      kind: "transient",
      retryable: true,
    });
  }

  const bytes = await file.arrayBuffer();
  const uploadResponse = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": mediaContentType(path),
    },
    body: bytes,
    signal: AbortSignal.timeout(60_000),
  });

  if (!uploadResponse.ok) {
    const detail = await readError(uploadResponse);
    const classified = classify(uploadResponse, "media");
    throw new LinkedInError(detail.message, {
      kind: classified.kind,
      status: classified.status,
      retryable: classified.retryable,
      retryAfterMs: detail.retryAfterMs ?? classified.retryAfterMs,
    });
  }

  // LinkedIn processes the asset asynchronously. The Posts API accepts the
  // image URN immediately and publishes once processing completes, so there
  // is no reliable reason to block here (and w_member_social is write-only,
  // which means the image status endpoint cannot be read).
  return imageUrn;
}

/**
 * Creates the member-authored post. This is the only irreversible API call.
 * Network failures and 5xx responses are marked "uncertain" so the scheduler
 * never blindly retries a post that may already exist.
 */
export async function createLinkedInPost(options: {
  accessToken: string;
  authorUrn: string;
  commentary: string;
  imageUrns: string[];
}): Promise<{ postUrn: string; permalink: string }> {
  const { accessToken, authorUrn, commentary, imageUrns } = options;

  if (!/^urn:li:(person|organization):\d+$/.test(authorUrn)) {
    throw new LinkedInError(`The destination author URN is not valid: ${authorUrn}`, {
      kind: "invalid",
    });
  }

  if (!commentary.trim()) {
    throw new LinkedInError("The post caption is empty.", { kind: "invalid" });
  }

  if (commentary.length > 3000) {
    throw new LinkedInError(
      `LinkedIn captions are limited to 3000 characters (this one is ${commentary.length}).`,
      { kind: "invalid" },
    );
  }

  if (imageUrns.length > 20) {
    throw new LinkedInError("LinkedIn multi-image posts support at most 20 images.", {
      kind: "invalid",
    });
  }

  const payload: Record<string, unknown> = {
    author: authorUrn,
    commentary,
    visibility: "PUBLIC",
    distribution: {
      feedDistribution: "MAIN_FEED",
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };

  if (imageUrns.length === 1) {
    payload.content = { media: { id: imageUrns[0] } };
  } else if (imageUrns.length > 1) {
    payload.content = {
      multiImage: {
        images: imageUrns.map((id) => ({ id })),
      },
    };
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE}/rest/posts`, {
      method: "POST",
      headers: { ...authHeaders(accessToken), "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(45_000),
    });
  } catch (error) {
    throw new LinkedInError(
      `The request to LinkedIn did not complete (${
        error instanceof Error ? error.message : "network error"
      }). The post may exist. Check LinkedIn before retrying.`,
      { kind: "uncertain", uncertain: true, retryable: false },
    );
  }

  if (!response.ok) {
    const detail = await readError(response);
    const classified = classify(response, "post");
    throw new LinkedInError(detail.message, {
      kind: classified.kind,
      status: classified.status,
      retryable: classified.retryable,
      uncertain: classified.uncertain,
      retryAfterMs: detail.retryAfterMs ?? classified.retryAfterMs,
    });
  }

  const postUrn =
    response.headers.get("x-restli-id") ??
    response.headers.get("x-linkedin-id") ??
    null;

  if (!postUrn) {
    throw new LinkedInError(
      "LinkedIn accepted the request but returned no post ID. The post may exist. Check LinkedIn before retrying.",
      { kind: "uncertain", uncertain: true, status: response.status },
    );
  }

  return {
    postUrn,
    permalink: `https://www.linkedin.com/feed/update/${postUrn}/`,
  };
}

export function composeCommentary(caption: string, hashtags: string): string {
  const cleanCaption = caption.trim();
  const cleanTags = hashtags.trim();
  const text = cleanTags ? `${cleanCaption}\n\n${cleanTags}` : cleanCaption;
  return text.trim();
}

export async function fetchLinkedInUserInfo(accessToken: string): Promise<{
  sub: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
}> {
  const response = await fetch(`${API_BASE}/v2/userinfo`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    const detail = await readError(response);
    throw new LinkedInError(detail.message, { kind: "token_expired", status: response.status });
  }

  return (await response.json()) as {
    sub: string;
    name?: string;
    given_name?: string;
    family_name?: string;
    picture?: string;
  };
}

export function sanitizeError(error: unknown): string {
  if (error instanceof LinkedInError) return error.message;
  if (error instanceof Error) return error.message;
  return "Unknown publishing error";
}

export function isRetryableError(error: unknown): boolean {
  return error instanceof LinkedInError && error.retryable && !error.uncertain;
}
