import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { apiError, logEvent } from "@/lib/api";
import { createAdminClient } from "@/lib/supabase/admin";
import { DestinationSyncError, syncDestinations } from "@/lib/linkedin-discovery";
import type { DestinationSyncResult } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type AccountSync =
  | { memberUrn: string; ok: true; result: DestinationSyncResult }
  | { memberUrn: string; ok: false; error: string };

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

  let accounts: { member_urn: string }[] = [];
  try {
    const { data, error } = await admin
      .from("linkedin_accounts")
      .select("member_urn")
      .not("status", "eq", "disconnected")
      .order("connected_at", { ascending: true });
    if (error) throw new Error(error.message);
    accounts = data ?? [];
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Connected LinkedIn accounts could not be read.";
    await logEvent(admin, null, "destination_sync_failed", message);
    return apiError(message, 500);
  }

  // Sync each account independently: one expired token must not abort every
  // other profile's refresh.
  const results: AccountSync[] = [];
  for (const account of accounts) {
    try {
      const result = await syncDestinations(admin, account.member_urn);
      results.push({ memberUrn: account.member_urn, ok: true, result });
    } catch (error) {
      const message =
        error instanceof DestinationSyncError
          ? error.message
          : error instanceof Error
            ? error.message
            : "Destination synchronization failed.";
      results.push({ memberUrn: account.member_urn, ok: false, error: message });
    }
  }

  // No account rows (legacy single-profile deployment): fall back to the
  // primary connection stored in settings.
  if (results.length === 0) {
    try {
      const result = await syncDestinations(admin);
      return NextResponse.json(result);
    } catch (error) {
      if (error instanceof DestinationSyncError) {
        await logEvent(admin, null, "destination_sync_failed", error.message);
        return apiError(error.message, error.status);
      }
      const message =
        error instanceof Error ? error.message : "Destination synchronization failed.";
      await logEvent(admin, null, "destination_sync_failed", message);
      return apiError(message, 500);
    }
  }

  const succeeded = results.filter(
    (entry): entry is Extract<AccountSync, { ok: true }> => entry.ok,
  );
  const failed = results.filter(
    (entry): entry is Extract<AccountSync, { ok: false }> => !entry.ok,
  );

  if (succeeded.length === 0) {
    const message = `Destination sync failed for every connected account. ${failed
      .map((entry) => entry.error)
      .join(" ")}`.trim();
    await logEvent(admin, null, "destination_sync_failed", message);
    return apiError(message, 502);
  }

  const discovered = succeeded.reduce((total, entry) => total + entry.result.discovered, 0);
  const organizations = succeeded.reduce((total, entry) => total + entry.result.organizations, 0);
  const unavailable = succeeded.reduce((total, entry) => total + entry.result.unavailable, 0);

  const warnings = [
    ...succeeded
      .map((entry) => entry.result.permissionWarning)
      .filter((value): value is string => Boolean(value)),
    ...failed.map((entry) => `${entry.memberUrn}: ${entry.error}`),
  ];

  const permissionWarning = warnings.length > 0 ? warnings.join(" ") : null;

  const parts = [
    `Synced ${discovered} destination${discovered === 1 ? "" : "s"} across ${
      succeeded.length
    } account${succeeded.length === 1 ? "" : "s"}`,
  ];
  if (organizations > 0) {
    parts.push(`${organizations} organization${organizations === 1 ? "" : "s"} discovered`);
  }
  if (unavailable > 0) {
    parts.push(`${unavailable} marked unavailable`);
  }
  if (failed.length > 0) {
    parts.push(`${failed.length} account${failed.length === 1 ? "" : "s"} could not sync`);
  }
  const message = `${parts.join(", ")}.`;

  await logEvent(
    admin,
    null,
    permissionWarning ? "destination_sync_warning" : "destination_sync",
    message,
    {
      accounts: results.map((entry) =>
        entry.ok
          ? { member_urn: entry.memberUrn, ok: true, discovered: entry.result.discovered }
          : { member_urn: entry.memberUrn, ok: false, error: entry.error },
      ),
    },
  );

  const response: DestinationSyncResult & {
    accounts: { memberUrn: string; ok: boolean; error?: string }[];
  } = {
    ok: failed.length === 0,
    memberSynced: true,
    organizations,
    discovered,
    unavailable,
    permissionWarning,
    message,
    accounts: results.map((entry) =>
      entry.ok
        ? { memberUrn: entry.memberUrn, ok: true }
        : { memberUrn: entry.memberUrn, ok: false, error: entry.error },
    ),
  };

  return NextResponse.json(response);
}
