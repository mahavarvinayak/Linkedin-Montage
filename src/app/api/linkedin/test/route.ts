import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { apiError, logEvent } from "@/lib/api";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadLinkedInAccess, LinkedInTokenError } from "@/lib/linkedin-tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  let admin;
  try {
    admin = createAdminClient();
  } catch (error) {
    return apiError(
      error instanceof Error ? error.message : "Supabase service role is not configured.",
      503,
    );
  }

  let access;
  try {
    access = await loadLinkedInAccess(admin);
  } catch (error) {
    if (error instanceof LinkedInTokenError) {
      const status = error.code === "not_connected" ? 409 : 401;
      await logEvent(admin, null, "linkedin_test_failed", error.message);
      return apiError(error.message, status);
    }
    return apiError(
      error instanceof Error ? error.message : "Could not read the LinkedIn token.",
      500,
    );
  }

  let response: Response;
  try {
    response = await fetch("https://api.linkedin.com/v2/userinfo", {
      headers: { Authorization: `Bearer ${access.accessToken}` },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    const message =
      error instanceof Error && error.name === "TimeoutError"
        ? "LinkedIn did not respond in time."
        : "Could not reach LinkedIn.";
    return apiError(message, 502);
  }

  if (response.status === 401) {
    const message = "LinkedIn rejected the token. Reconnect your account.";
    await admin.from("settings").update({ linkedin_last_error: message }).eq("id", 1);
    await logEvent(admin, null, "linkedin_test_failed", message);
    return apiError(message, 401);
  }

  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 200);
    const message = `LinkedIn returned HTTP ${response.status}. ${detail}`.trim();
    return apiError(message, 502);
  }

  const profile = (await response.json()) as {
    sub?: string;
    name?: string;
    picture?: string;
  };

  const scopes = access.scopes;
  const missingMemberScope = !scopes.includes("w_member_social");
  const organizationPublishing = scopes.includes("w_organization_social");
  const organizationDiscovery = scopes.includes("r_organization_admin");

  const warnings: string[] = [];
  if (missingMemberScope) {
    warnings.push(
      "The token does not include w_member_social, so personal publishing will fail. Reconnect and approve the posting permission.",
    );
  }
  if (!organizationPublishing) {
    warnings.push(
      "The token does not include w_organization_social, so Company and Showcase Page publishing is not authorized. This needs approved Community Management API access; being an organization admin alone is not enough.",
    );
  }

  const warning = warnings.length > 0 ? warnings.join(" ") : null;

  await admin
    .from("settings")
    .update({
      linkedin_last_error: warning,
      linkedin_member_name: profile.name ?? undefined,
      linkedin_member_picture: profile.picture ?? undefined,
    })
    .eq("id", 1);

  await logEvent(
    admin,
    null,
    warning ? "linkedin_test_warning" : "linkedin_test_passed",
    warning ?? "LinkedIn connection verified.",
    {
      member_id: profile.sub ?? access.memberId,
      scopes,
      organization_publishing: organizationPublishing,
      organization_discovery: organizationDiscovery,
    },
  );

  return NextResponse.json({
    ok: true,
    profile: {
      memberId: profile.sub ?? access.memberId,
      name: profile.name ?? null,
      picture: profile.picture ?? null,
    },
    scopes,
    warning,
    organizationPublishing,
    organizationDiscovery,
  });
}
