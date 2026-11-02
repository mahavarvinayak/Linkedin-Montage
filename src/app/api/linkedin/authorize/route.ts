import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { requireAdminApi } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { getLinkedInEnv } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_COOKIE = "linkedin_oauth_state";

export async function GET() {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const { clientId, redirectUri, scopes } = getLinkedInEnv();

  if (!clientId) {
    return apiError("LINKEDIN_CLIENT_ID is not configured on the server.", 503);
  }

  if (scopes.length === 0) {
    return apiError("No LinkedIn OAuth scopes are configured.", 503);
  }

  const state = randomBytes(24).toString("hex");
  const authorizeUrl = new URL("https://www.linkedin.com/oauth/v2/authorization");
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("scope", scopes.join(" "));

  const response = NextResponse.redirect(authorizeUrl.toString(), { status: 302 });
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 10 * 60,
  });

  return response;
}
