import { cache } from "react";
import type {
  DestinationRow,
  LinkedInAccountRow,
  PostJobView,
  PostStatus,
  PostView,
  PublishingLogRow,
  SettingsRow,
} from "@/lib/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import { getEnvironmentStatus } from "@/lib/env";
import { startOfMonthISTIso } from "@/lib/ist";
import { normalizePostRow, POST_COLUMNS } from "@/lib/post-utils";
import { isDestinationSelectable } from "@/lib/destinations";

const JOB_COLUMNS = [
  "id",
  "post_id",
  "destination_id",
  "author_urn",
  "status",
  "scheduled_at",
  "attempts",
  "max_attempts",
  "next_attempt_at",
  "last_attempt_at",
  "published_at",
  "linkedin_post_id",
  "permalink",
  "last_error",
  "created_at",
  "updated_at",
].join(", ");

export const POST_SELECT = `${POST_COLUMNS}, publishing_jobs(${JOB_COLUMNS}, destination:linkedin_destinations(id, name, destination_type, status, publish_authorized, is_enabled, author_urn))`;

export const DESTINATION_COLUMNS = "*";

function normalizeJob(row: Record<string, unknown>): PostJobView {
  const rawDestination = row.destination as
    | PostJobView["destination"]
    | PostJobView["destination"][]
    | null
    | undefined;

  return {
    ...(row as unknown as PostJobView),
    destination: Array.isArray(rawDestination) ? (rawDestination[0] ?? null) : (rawDestination ?? null),
  };
}

function normalizeJobs(value: unknown): PostJobView[] {
  if (!Array.isArray(value)) return [];
  return (value as Record<string, unknown>[]).map(normalizeJob);
}

export async function getSignedMediaUrls(paths: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(paths.filter(Boolean))];
  if (unique.length === 0) return {};

  const admin = tryCreateAdminClient();
  if (!admin) return {};

  const { data, error } = await admin.storage.from("media").createSignedUrls(unique, 3600);
  if (error) {
    console.error("Could not create signed media URLs", error.message);
    return {};
  }

  const map: Record<string, string> = {};
  for (const item of data ?? []) {
    if (item.path && item.signedUrl) map[item.path] = item.signedUrl;
  }
  return map;
}

async function decoratePosts(rows: Record<string, unknown>[]): Promise<PostView[]> {
  const posts = rows.map((row) => {
    const { publishing_jobs: rawJobs, ...postRow } = row;
    return {
      ...normalizePostRow(postRow),
      jobs: normalizeJobs(rawJobs).sort((a, b) =>
        (a.destination?.name ?? "").localeCompare(b.destination?.name ?? ""),
      ),
    };
  });

  const paths = posts
    .filter((post) => !post.media_deleted_at)
    .flatMap((post) => post.media_paths);
  const urls = await getSignedMediaUrls(paths);

  return posts.map((post) => ({
    ...post,
    media: post.media_paths.map((path) => ({
      path,
      url: post.media_deleted_at ? null : (urls[path] ?? null),
    })),
  }));
}

export async function listPosts(
  statuses: PostStatus[],
  options: { limit?: number; orderBy?: "scheduled" | "published" | "updated" } = {},
): Promise<PostView[]> {
  const supabase = await createServerSupabaseClient();
  let query = supabase.from("posts").select(POST_SELECT).in("status", statuses);

  if (options.orderBy === "published") {
    query = query.order("published_at", { ascending: false, nullsFirst: false });
  } else if (options.orderBy === "updated") {
    query = query.order("updated_at", { ascending: false });
  } else {
    query = query
      .order("scheduled_at", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false });
  }

  const { data, error } = await query.limit(options.limit ?? 100);
  if (error) throw new Error(error.message);

  return decoratePosts((data ?? []) as unknown as Record<string, unknown>[]);
}

export async function getPost(id: string): Promise<PostView | null> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.from("posts").select(POST_SELECT).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const [post] = await decoratePosts([data as unknown as Record<string, unknown>]);
  return post ?? null;
}

/**
 * Every destination, whatever its state, so the management screen can explain
 * unavailable or unauthorized entries instead of hiding them.
 */
export const listDestinations = cache(async (): Promise<DestinationRow[]> => {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("linkedin_destinations")
    .select(DESTINATION_COLUMNS)
    .order("destination_type", { ascending: true })
    .order("name", { ascending: true });

  if (error) throw new Error(error.message);

  const rows = (data ?? []) as DestinationRow[];
  return rows.sort((a, b) => {
    if (a.destination_type === "personal_profile" && b.destination_type !== "personal_profile") return -1;
    if (b.destination_type === "personal_profile" && a.destination_type !== "personal_profile") return 1;
    return a.name.localeCompare(b.name);
  });
});

export function splitDestinations(destinations: DestinationRow[]): {
  selectable: DestinationRow[];
  blocked: DestinationRow[];
} {
  return {
    selectable: destinations.filter((destination) => isDestinationSelectable(destination)),
    blocked: destinations.filter((destination) => !isDestinationSelectable(destination)),
  };
}

export const getDestinationStats = cache(async (): Promise<{
  total: number;
  selectable: number;
  unavailable: number;
  missingPermission: number;
}> => {
  try {
    const destinations = await listDestinations();
    return {
      total: destinations.length,
      selectable: destinations.filter((destination) => isDestinationSelectable(destination)).length,
      unavailable: destinations.filter((destination) => destination.status === "unavailable").length,
      missingPermission: destinations.filter(
        (destination) => destination.status === "permission_missing",
      ).length,
    };
  } catch {
    return { total: 0, selectable: 0, unavailable: 0, missingPermission: 0 };
  }
});

export async function listRecentLogs(limit = 10): Promise<PublishingLogRow[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("publishing_logs")
    .select("id, post_id, event_type, message, metadata, created_at, post:posts(id, caption)")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);

  return ((data ?? []) as Record<string, unknown>[]).map((row) => {
    const post = row.post as PublishingLogRow["post"] | PublishingLogRow["post"][] | null;
    return {
      ...(row as unknown as PublishingLogRow),
      post: Array.isArray(post) ? (post[0] ?? null) : post,
    };
  });
}

export const getSettingsRow = cache(async (): Promise<SettingsRow | null> => {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.from("settings").select("*").eq("id", 1).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as SettingsRow | null) ?? null;
});

export const getNavCounts = cache(async (): Promise<{ queue: number; failed: number }> => {
  try {
    const supabase = await createServerSupabaseClient();
    const { data } = await supabase
      .from("posts")
      .select("status")
      .in("status", ["draft", "scheduled", "publishing", "failed", "manual_required"]);

    let queue = 0;
    let failed = 0;
    for (const row of data ?? []) {
      if (row.status === "failed" || row.status === "manual_required") {
        failed++;
      } else {
        queue++;
      }
    }

    return { queue, failed };
  } catch {
    return { queue: 0, failed: 0 };
  }
});

export interface OverviewData {
  counts: {
    scheduled: number;
    drafts: number;
    publishedThisMonth: number;
    failed: number;
  };
  destinations: {
    total: number;
    selectable: number;
  };
  upcoming: PostView[];
  logs: PublishingLogRow[];
}

export async function getOverviewData(): Promise<OverviewData> {
  const supabase = await createServerSupabaseClient();
  const monthStart = startOfMonthISTIso();

  const [postsRes, upcoming, destinationStats, logs] = await Promise.all([
    supabase.from("posts").select("status, published_at"),
    supabase
      .from("posts")
      .select(POST_SELECT)
      .eq("status", "scheduled")
      .not("scheduled_at", "is", null)
      .order("scheduled_at", { ascending: true })
      .limit(5),
    getDestinationStats(),
    listRecentLogs(8),
  ]);

  if (upcoming.error) throw new Error(upcoming.error.message);

  let scheduled = 0;
  let drafts = 0;
  let publishedThisMonth = 0;
  let failed = 0;

  for (const post of (postsRes.data ?? []) as { status: string; published_at: string | null }[]) {
    if (post.status === "scheduled") scheduled++;
    else if (post.status === "draft") drafts++;
    else if (post.status === "failed" || post.status === "manual_required") failed++;
    else if (post.status === "published" && post.published_at && post.published_at >= monthStart) {
      publishedThisMonth++;
    }
  }

  return {
    counts: {
      scheduled,
      drafts,
      publishedThisMonth,
      failed,
    },
    destinations: {
      total: destinationStats.total,
      selectable: destinationStats.selectable,
    },
    upcoming: await decoratePosts((upcoming.data ?? []) as unknown as Record<string, unknown>[]),
    logs,
  };
}

export interface IntegrationStatus {
  bucketReady: boolean;
  dbReady: boolean;
  adminSeeded: boolean;
  settings: SettingsRow | null;
  environment: ReturnType<typeof getEnvironmentStatus>;
  tokenExpired: boolean;
  tokenExpiringSoon: boolean;
  linkedinReady: boolean;
  storageError: string | null;
  destinations: {
    total: number;
    selectable: number;
    unavailable: number;
    missingPermission: number;
    syncedAt: string | null;
    lastError: string | null;
  };
}

export async function getIntegrationStatus(): Promise<IntegrationStatus> {
  const environment = getEnvironmentStatus();
  let settings: SettingsRow | null = null;
  let dbReady = false;
  let bucketReady = false;
  let adminSeeded = false;
  let storageError: string | null = null;
  let destinationStats = { total: 0, selectable: 0, unavailable: 0, missingPermission: 0 };
  let anyAccountConnected = false;

  try {
    const [settingsRow, destStats] = await Promise.all([getSettingsRow(), getDestinationStats()]);
    settings = settingsRow;
    dbReady = Boolean(settings);
    destinationStats = destStats;
  } catch (error) {
    storageError = error instanceof Error ? error.message : "Database check failed";
  }

  const admin = tryCreateAdminClient();
  if (admin) {
    try {
      const [bucketRes, adminsRes, accountsRes] = await Promise.all([
        admin.storage.getBucket("media").catch((err) => ({ error: err })),
        admin.from("app_admins").select("*", { count: "exact", head: true }),
        admin
          .from("linkedin_accounts")
          .select("*", { count: "exact", head: true })
          .neq("status", "disconnected"),
      ]);

      bucketReady = !bucketRes.error;
      if (bucketRes.error) storageError = bucketRes.error.message;
      adminSeeded = (adminsRes.count ?? 0) > 0;
      anyAccountConnected = (accountsRes.count ?? 0) > 0;
    } catch (error) {
      storageError = error instanceof Error ? error.message : "Diagnostics check failed";
    }
  }

  const expiresAt = settings?.linkedin_token_expires_at
    ? new Date(settings.linkedin_token_expires_at).getTime()
    : null;

  const tokenExpired = Boolean(expiresAt && expiresAt < Date.now());
  const tokenExpiringSoon = Boolean(
    expiresAt && expiresAt >= Date.now() && expiresAt < Date.now() + 7 * 24 * 60 * 60 * 1000,
  );

  const primaryReady =
    Boolean(settings?.linkedin_connected) &&
    Boolean(settings?.linkedin_member_id) &&
    !tokenExpired;

  const linkedinReady =
    environment.linkedin.configured && (anyAccountConnected || primaryReady);

  return {
    bucketReady,
    dbReady,
    adminSeeded,
    settings,
    environment,
    tokenExpired,
    tokenExpiringSoon,
    linkedinReady,
    storageError,
    destinations: {
      ...destinationStats,
      syncedAt: settings?.destinations_synced_at ?? null,
      lastError: settings?.destinations_last_error ?? null,
    },
  };
}

export const listLinkedInAccounts = cache(async (): Promise<LinkedInAccountRow[]> => {
  const supabase = await createServerSupabaseClient();
  const admin = tryCreateAdminClient();
  const { data, error } = await supabase
    .from("linkedin_accounts")
    .select("*")
    .order("connected_at", { ascending: false });

  if (error) {
    console.error("Could not load linkedin accounts", error.message);
    return [];
  }

  const rows = (data ?? []) as LinkedInAccountRow[];
  if (!admin || rows.length === 0) return rows;

  const checked = await Promise.all(
    rows.map(async (acc) => {
      try {
        const { data: token } = await admin.rpc("admin_get_account_tokens", {
          p_member_urn: acc.member_urn,
        });
        return {
          ...acc,
          has_token: Boolean(token && (token as any).access_token),
        };
      } catch {
        return { ...acc, has_token: false };
      }
    }),
  );

  return checked;
});
