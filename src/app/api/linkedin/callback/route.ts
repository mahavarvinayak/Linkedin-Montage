import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { getLinkedInEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/api";
import { syncDestinations } from "@/lib/linkedin-discovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_COOKIE = "linkedin_oauth_state";
const TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
const USERINFO_URL = "https://api.linkedin.com/v2/userinfo";

type LinkedInTokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
};

type LinkedInUserInfo = {
  sub?: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
};

function settingsRedirect(
  request: Request,
  params: Record<string, string>,
  clearState = true,
): NextResponse {
  const url = new URL("/settings", request.url);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = NextResponse.redirect(url, { status: 303 });
  if (clearState) response.cookies.delete(STATE_COOKIE);
  return response;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 300);
  return "Unknown OAuth error";
}

export async function GET(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const oauthError = searchParams.get("error");
  const oauthDescription = searchParams.get("error_description");
  const code = searchParams.get("code");
  const state = searchParams.get("state");

  if (oauthError) {
    return settingsRedirect(request, {
      linkedin: "error",
      message: oauthDescription || oauthError,
    });
  }

  const expectedState = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${STATE_COOKIE}=`))
    ?.slice(STATE_COOKIE.length + 1);

  if (!state || !expectedState || state !== expectedState) {
    return settingsRedirect(request, {
      linkedin: "error",
      message: "The OAuth state check failed. Start the connection again from Settings.",
    });
  }

  if (!code) {
    return settingsRedirect(request, {
      linkedin: "error",
      message: "LinkedIn did not return an authorization code.",
    });
  }

  const { clientId, clientSecret, redirectUri } = getLinkedInEnv();
  if (!clientId || !clientSecret) {
    return settingsRedirect(request, {
      linkedin: "error",
      message: "LinkedIn client credentials are missing from the server environment.",
    });
  }

  const admin = createAdminClient();

  try {
    const tokenResponse = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });

    const tokens = (await tokenResponse.json().catch(() => ({}))) as LinkedInTokenResponse;

    if (!tokenResponse.ok || !tokens.access_token) {
      const detail =
        tokens.error_description ||
        tokens.error ||
        `LinkedIn token exchange failed with HTTP ${tokenResponse.status}.`;
      await logEvent(admin, null, "linkedin_connect_failed", detail.slice(0, 400));
      return settingsRedirect(request, { linkedin: "error", message: detail });
    }

    const userResponse = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });

    if (!userResponse.ok) {
      const detail = await userResponse.text().catch(() => "");
      const message = `LinkedIn accepted the authorization but the profile read failed (HTTP ${userResponse.status}). ${detail.slice(0, 160)}`;
      await logEvent(admin, null, "linkedin_connect_failed", message);
      return settingsRedirect(request, { linkedin: "error", message });
    }

    const profile = (await userResponse.json()) as LinkedInUserInfo;
    if (!profile.sub) {
      await logEvent(admin, null, "linkedin_connect_failed", "LinkedIn userinfo response had no member ID.");
      return settingsRedirect(request, {
        linkedin: "error",
        message: "LinkedIn did not return a member ID for this profile.",
      });
    }

    const expiresAt = tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      : null;
    const grantedScope = tokens.scope || getLinkedInEnv().scopes.join(" ");
    const scopeList = grantedScope
      .split(/[\s,]+/)
      .filter(Boolean);

    const memberUrn = `urn:li:person:${profile.sub}`;
    const name =
      profile.name ||
      [profile.given_name, profile.family_name].filter(Boolean).join(" ") ||
      null;

    const stored = await admin.rpc("admin_store_account_tokens", {
      p_member_urn: memberUrn,
      p_access_token: tokens.access_token,
      p_refresh_token: tokens.refresh_token ?? null,
      p_expires_at: expiresAt,
      p_scope: grantedScope || null,
    });

    if (stored.error) {
      await logEvent(admin, null, "linkedin_connect_failed", stored.error.message);
      return settingsRedirect(request, {
        linkedin: "error",
        message: `LinkedIn authorized, but the token could not be stored: ${stored.error.message}`,
      });
    }

    // Upsert into linkedin_accounts
    await admin.from("linkedin_accounts").upsert(
      {
        member_urn: memberUrn,
        name: name || "Personal profile",
        picture: profile.picture ?? null,
        token_expires_at: expiresAt,
        scopes: scopeList,
        status: "connected",
        last_error: null,
        connected_at: new Date().toISOString(),
      },
      { onConflict: "member_urn" },
    );

    const { error } = await admin
      .from("settings")
      .update({
        linkedin_member_id: profile.sub,
        linkedin_member_name: name,
        linkedin_member_picture: profile.picture ?? null,
        linkedin_connected: true,
        linkedin_connected_at: new Date().toISOString(),
        linkedin_token_expires_at: expiresAt,
        linkedin_scopes: scopeList,
        linkedin_last_error: null,
      })
      .eq("id", 1);

    if (error) {
      await logEvent(admin, null, "linkedin_connect_failed", error.message);
      return settingsRedirect(request, {
        linkedin: "error",
        message: `LinkedIn authorized, but saving the connection failed: ${error.message}`,
      });
    }

    await logEvent(admin, null, "linkedin_connected", "LinkedIn account connected.", {
      member_id: profile.sub,
      scopes: scopeList,
    });

    // Discover destinations immediately so the composer is usable without a
    // second manual step. A failure here must not invalidate the connection.
    let note: string | undefined;
    try {
      const synced = await syncDestinations(admin, memberUrn);
      note = synced.permissionWarning ?? undefined;
    } catch (error) {
      note =
        error instanceof Error
          ? `Connected, but destinations could not be synced: ${error.message}`
          : "Connected, but destinations could not be synced.";
      await logEvent(admin, null, "destination_sync_failed", note);
    }

    return settingsRedirect(request, note ? { linkedin: "connected", note } : { linkedin: "connected" });
  } catch (error) {
    const message =
      error instanceof Error && error.name === "TimeoutError"
        ? "LinkedIn did not respond in time. Try connecting again."
        : errorMessage(error);

    await logEvent(admin, null, "linkedin_connect_failed", message);
    return settingsRedirect(request, { linkedin: "error", message });
  }
}
