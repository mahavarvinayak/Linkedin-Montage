import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { apiError, logEvent } from "@/lib/api";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DISCONNECTED_DETAIL = "This LinkedIn account was disconnected in Cadence.";

/** Mirror whichever account is now primary into the legacy shared secret. */
async function syncLegacyPrimary(
  admin: ReturnType<typeof createAdminClient>,
  memberUrn: string,
) {
  const { data: tokens } = await admin.rpc("admin_get_account_tokens", {
    p_member_urn: memberUrn,
  });
  const record = (tokens ?? null) as {
    access_token?: string;
    refresh_token?: string | null;
    expires_at?: string | null;
    scope?: string | null;
  } | null;

  if (!record?.access_token) return;

  await admin.rpc("admin_store_account_tokens", {
    p_member_urn: memberUrn,
    p_access_token: record.access_token,
    p_refresh_token: record.refresh_token ?? null,
    p_expires_at: record.expires_at ?? null,
    p_scope: record.scope ?? null,
  });
}

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
    const { error: accountError } = await admin
      .from("linkedin_accounts")
      .delete()
      .eq("member_urn", memberUrn);
    if (accountError) {
      return apiError(`Could not disconnect that account: ${accountError.message}`, 500);
    }

    await admin.rpc("admin_delete_account_tokens", { p_member_urn: memberUrn });

    // Disable every destination owned by the account: the personal profile and
    // all organizations that were synced through this profile's token.
    const { error: ownerError } = await admin
      .from("linkedin_destinations")
      .update({
        status: "unavailable",
        publish_authorized: false,
        status_detail: DISCONNECTED_DETAIL,
      })
      .eq("account_urn", memberUrn);

    const { error: personalError } = await admin
      .from("linkedin_destinations")
      .update({
        status: "unavailable",
        publish_authorized: false,
        status_detail: DISCONNECTED_DETAIL,
      })
      .eq("author_urn", memberUrn)
      .eq("destination_type", "personal_profile");

    const destinationError = ownerError ?? personalError;
    if (destinationError) {
      await logEvent(admin, null, "linkedin_disconnect_warning", destinationError.message);
    }

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
          linkedin_last_error: null,
        })
        .eq("id", 1);

      // The legacy secret may still hold the disconnected profile's token.
      // Re-point it at the account that just became primary.
      await syncLegacyPrimary(admin, nextAcc.member_urn);
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

  // Fallback: disconnect every account.
  const { data: accounts } = await admin.from("linkedin_accounts").select("member_urn");

  const { error: tokenError } = await admin.rpc("admin_delete_linkedin_tokens");
  if (tokenError) {
    return apiError(`Could not remove the stored token: ${tokenError.message}`, 500);
  }

  for (const account of accounts ?? []) {
    if (account.member_urn) {
      await admin.rpc("admin_delete_account_tokens", { p_member_urn: account.member_urn });
    }
  }

  await admin.from("linkedin_accounts").delete().neq("id", "00000000-0000-0000-0000-000000000000");

  await admin
    .from("linkedin_destinations")
    .update({
      status: "unavailable",
      publish_authorized: false,
      status_detail: DISCONNECTED_DETAIL,
    })
    .neq("status", "unavailable");

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

  await logEvent(admin, null, "linkedin_disconnected", "All LinkedIn accounts disconnected.");

  return NextResponse.json({ ok: true });
}
