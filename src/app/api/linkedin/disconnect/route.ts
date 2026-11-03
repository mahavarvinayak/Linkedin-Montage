import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { apiError, logEvent } from "@/lib/api";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
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

  const body = (await request.json().catch(() => null)) as { member_urn?: string } | null;
  const memberUrn = body?.member_urn;

  if (memberUrn) {
    await admin.rpc("admin_delete_account_tokens", { p_member_urn: memberUrn });
    await admin.from("linkedin_accounts").delete().eq("member_urn", memberUrn);
    await admin
      .from("linkedin_destinations")
      .update({
        status: "unavailable",
        publish_authorized: false,
        status_detail: "This account was disconnected.",
      })
      .eq("author_urn", memberUrn);

    // Check remaining accounts
    const { data: remaining } = await admin
      .from("linkedin_accounts")
      .select("member_urn, name, picture, token_expires_at, scopes")
      .order("connected_at", { ascending: false })
      .limit(1);

    if (remaining && remaining.length > 0) {
      const nextAcc = remaining[0];
      await admin
        .from("settings")
        .update({
          linkedin_connected: true,
          linkedin_member_id: nextAcc.member_urn.replace(/^urn:li:person:/, ""),
          linkedin_member_name: nextAcc.name,
          linkedin_member_picture: nextAcc.picture,
          linkedin_token_expires_at: nextAcc.token_expires_at,
          linkedin_scopes: nextAcc.scopes ?? [],
        })
        .eq("id", 1);
    } else {
      await admin.rpc("admin_delete_linkedin_tokens");
      await admin
        .from("settings")
        .update({
          linkedin_connected: false,
          linkedin_member_id: null,
          linkedin_member_name: null,
          linkedin_member_picture: null,
          linkedin_connected_at: null,
          linkedin_token_expires_at: null,
          linkedin_scopes: [],
          linkedin_last_error: null,
        })
        .eq("id", 1);
    }

    await logEvent(admin, null, "linkedin_disconnected", `LinkedIn account ${memberUrn} disconnected.`);
    return NextResponse.json({ ok: true });
  }

  // Fallback: disconnect all
  const { error: tokenError } = await admin.rpc("admin_delete_linkedin_tokens");
  if (tokenError) {
    return apiError(`Could not remove the stored token: ${tokenError.message}`, 500);
  }

  await admin.from("linkedin_accounts").delete().neq("id", "00000000-0000-0000-0000-000000000000");

  const { error } = await admin
    .from("settings")
    .update({
      linkedin_connected: false,
      linkedin_member_id: null,
      linkedin_member_name: null,
      linkedin_member_picture: null,
      linkedin_connected_at: null,
      linkedin_token_expires_at: null,
      linkedin_scopes: [],
      linkedin_last_error: null,
    })
    .eq("id", 1);

  if (error) return apiError(`Could not update the connection state: ${error.message}`, 500);

  await logEvent(admin, null, "linkedin_disconnected", "LinkedIn account disconnected.");

  return NextResponse.json({ ok: true });
}
