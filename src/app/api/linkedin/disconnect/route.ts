import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { apiError, logEvent } from "@/lib/api";
import { createAdminClient } from "@/lib/supabase/admin";

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

  const { error: tokenError } = await admin.rpc("admin_delete_linkedin_tokens");
  if (tokenError) {
    return apiError(`Could not remove the stored token: ${tokenError.message}`, 500);
  }

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
