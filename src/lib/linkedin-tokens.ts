import type { SupabaseClient } from "@supabase/supabase-js";
import { getLinkedInEnv } from "@/lib/env";

export type TokenRecord = {
  access_token?: string;
  refresh_token?: string | null;
  expires_at?: string | null;
  scope?: string | null;
};

export type LinkedInAccess = {
  accessToken: string;
  scopes: string[];
  memberId: string;
  memberUrn: string;
  memberName: string | null;
};

const TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";

export class LinkedInTokenError extends Error {
  code: "not_connected" | "expired" | "provider";

  constructor(message: string, code: "not_connected" | "expired" | "provider") {
    super(message);
    this.name = "LinkedInTokenError";
    this.code = code;
  }
}

function splitScopes(value: string | null | undefined): string[] {
  return (value ?? "").split(/[\s,]+/).filter(Boolean);
}

async function primaryMemberUrn(admin: SupabaseClient): Promise<string | null> {
  const { data } = await admin
    .from("settings")
    .select("linkedin_member_id")
    .eq("id", 1)
    .maybeSingle();

  const id = data?.linkedin_member_id;
  if (!id) return null;
  return id.startsWith("urn:li:person:") ? id : `urn:li:person:${id}`;
}

async function refreshTokens(
  admin: SupabaseClient,
  tokens: TokenRecord,
  memberUrn?: string | null,
): Promise<{ accessToken: string; scopes: string[] }> {
  const { clientId, clientSecret } = getLinkedInEnv();

  if (!tokens.refresh_token) {
    throw new LinkedInTokenError(
      "The LinkedIn access token expired and no refresh token was issued. Reconnect LinkedIn.",
      "expired",
    );
  }

  if (!clientId || !clientSecret) {
    throw new LinkedInTokenError(
      "LinkedIn client credentials are not configured on this deployment, so the token cannot be refreshed.",
      "expired",
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
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });

  const payload = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
    scope?: string;
    error?: string;
    error_description?: string;
  };

  if (!response.ok || !payload.access_token) {
    const detail =
      payload.error_description ||
      payload.error ||
      `LinkedIn token refresh failed with HTTP ${response.status}.`;

    if (memberUrn) {
      await admin
        .from("linkedin_accounts")
        .update({ status: "expired", last_error: detail })
        .eq("member_urn", memberUrn);
    }

    const primary = memberUrn ? (await primaryMemberUrn(admin)) === memberUrn : true;
    if (primary) {
      await admin.from("settings").update({ linkedin_last_error: detail }).eq("id", 1);
    }

    throw new LinkedInTokenError(detail, "expired");
  }

  const expiresAt = payload.expires_in
    ? new Date(Date.now() + payload.expires_in * 1000).toISOString()
    : null;
  const scopes = splitScopes(payload.scope ?? tokens.scope ?? null);

  if (memberUrn) {
    await admin.rpc("admin_store_account_tokens", {
      p_member_urn: memberUrn,
      p_access_token: payload.access_token,
      p_refresh_token: payload.refresh_token ?? tokens.refresh_token,
      p_expires_at: expiresAt,
      p_scope: payload.scope ?? tokens.scope ?? null,
    });

    await admin
      .from("linkedin_accounts")
      .update({
        token_expires_at: expiresAt,
        scopes,
        status: "connected",
        last_error: null,
      })
      .eq("member_urn", memberUrn);
  } else {
    const stored = await admin.rpc("admin_store_linkedin_tokens", {
      p_access_token: payload.access_token,
      p_refresh_token: payload.refresh_token ?? tokens.refresh_token,
      p_expires_at: expiresAt,
      p_scope: payload.scope ?? tokens.scope ?? null,
    });

    if (stored.error) {
      throw new LinkedInTokenError(
        `The refreshed token could not be stored: ${stored.error.message}`,
        "provider",
      );
    }
  }

  const isPrimary = memberUrn ? (await primaryMemberUrn(admin)) === memberUrn : true;
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

  return { accessToken: payload.access_token, scopes };
}

/**
 * Server-only helper. Loads the stored OAuth token, refreshes it when it is
 * about to expire, and returns everything needed to call LinkedIn. Tokens are
 * read from Supabase Vault with the service role and never leave the server.
 */
export async function loadLinkedInAccess(
  admin: SupabaseClient,
  targetMemberUrn?: string | null,
): Promise<LinkedInAccess> {
  // A specific account was requested. Its own token must be used: never fall
  // back to another profile's token, which would publish as the wrong author.
  if (targetMemberUrn) {
    const { data: account, error: accountError } = await admin
      .from("linkedin_accounts")
      .select("member_urn, name, scopes, status")
      .eq("member_urn", targetMemberUrn)
      .maybeSingle();

    if (accountError) {
      throw new LinkedInTokenError(
        `Could not read the LinkedIn account: ${accountError.message}`,
        "provider",
      );
    }

    if (!account) {
      throw new LinkedInTokenError(
        "This LinkedIn account is no longer connected. Reconnect it in Settings.",
        "not_connected",
      );
    }

    const { data: tokens, error: tokenError } = await admin.rpc(
      "admin_get_account_tokens",
      { p_member_urn: targetMemberUrn },
    );

    if (tokenError) {
      throw new LinkedInTokenError(
        `Could not read the stored LinkedIn token for this account: ${tokenError.message}`,
        "provider",
      );
    }

    const record = (tokens ?? null) as TokenRecord | null;
    if (!record?.access_token) {
      throw new LinkedInTokenError(
        "No LinkedIn access token is stored for this account. Reconnect it in Settings.",
        "not_connected",
      );
    }

    const expiresAt = record.expires_at ? Date.parse(record.expires_at) : null;
    let accessToken: string = record.access_token;
    let scopes = splitScopes(record.scope ?? account.scopes?.join(" ") ?? null);

    if (expiresAt && expiresAt < Date.now() + 120_000) {
      const refreshed = await refreshTokens(admin, record, targetMemberUrn);
      accessToken = refreshed.accessToken;
      scopes = refreshed.scopes.length > 0 ? refreshed.scopes : scopes;
    }

    const memberId = targetMemberUrn.replace(/^urn:li:person:/, "");
    return {
      accessToken,
      scopes,
      memberId,
      memberUrn: targetMemberUrn,
      memberName: account.name ?? null,
    };
  }

  const { data: settings, error } = await admin
    .from("settings")
    .select(
      "linkedin_connected, linkedin_member_id, linkedin_member_name, linkedin_scopes",
    )
    .eq("id", 1)
    .maybeSingle();

  if (error) throw new LinkedInTokenError(error.message, "provider");
  if (!settings?.linkedin_connected || !settings.linkedin_member_id) {
    throw new LinkedInTokenError("LinkedIn is not connected yet.", "not_connected");
  }

  const { data: tokens, error: tokenError } = await admin.rpc("admin_get_linkedin_tokens");
  if (tokenError) {
    throw new LinkedInTokenError(
      `Could not read the stored LinkedIn token: ${tokenError.message}`,
      "provider",
    );
  }

  const record = (tokens ?? {}) as TokenRecord;
  if (!record.access_token) {
    throw new LinkedInTokenError(
      "No LinkedIn access token is stored. Reconnect your account.",
      "not_connected",
    );
  }

  const expiresAt = record.expires_at ? Date.parse(record.expires_at) : null;
  let accessToken = record.access_token;
  let scopes = splitScopes(record.scope ?? settings.linkedin_scopes?.join(" ") ?? null);

  if (expiresAt && expiresAt < Date.now() + 120_000) {
    const refreshed = await refreshTokens(admin, record);
    accessToken = refreshed.accessToken;
    scopes = refreshed.scopes.length > 0 ? refreshed.scopes : scopes;
  }

  const memberId = settings.linkedin_member_id.replace(/^urn:li:person:/, "");

  return {
    accessToken,
    scopes,
    memberId,
    memberUrn: `urn:li:person:${memberId}`,
    memberName: settings.linkedin_member_name,
  };
}
