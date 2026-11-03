import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { apiError, logEvent } from "@/lib/api";
import { createAdminClient } from "@/lib/supabase/admin";
import { DestinationSyncError, syncDestinations } from "@/lib/linkedin-discovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

  try {
    const { data: accounts } = await admin
      .from("linkedin_accounts")
      .select("member_urn")
      .eq("status", "connected");

    let result = null;
    if (accounts && accounts.length > 0) {
      for (const acc of accounts) {
        result = await syncDestinations(admin, acc.member_urn);
      }
    } else {
      result = await syncDestinations(admin);
    }

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof DestinationSyncError) {
      await logEvent(admin, null, "destination_sync_failed", error.message);
      return apiError(error.message, error.status);
    }

    const message = error instanceof Error ? error.message : "Destination synchronization failed.";
    await logEvent(admin, null, "destination_sync_failed", message);
    return apiError(message, 500);
  }
}
