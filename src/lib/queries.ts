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
export async function listDestinations(): Promise<DestinationRow[]> {
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
}

export function splitDestinations(destinations: DestinationRow[]): {
  selectable: DestinationRow[];
  blocked: DestinationRow[];
} {
  return {
    selectable: destinations.filter((destination) => isDestinationSelectable(destination)),
    blocked: destinations.filter((destination) => !isDestinationSelectable(destination)),
  };
}

export async function getDestinationStats(): Promise<{
  total: number;
  selectable: number;
  unavailable: number;
  missingPermission: number;
}> {
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
}

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

export async function getNavCounts(): Promise<{ queue: number; failed: number }> {
  try {
    const supabase = await createServerSupabaseClient();
    const [queue, failed] = await Promise.all([
      supabase
        .from("posts")
        .select("*", { count: "exact", head: true })
        .in("status", ["draft", "scheduled", "publishing"]),
      supabase
        .from("posts")
        .select("*", { count: "exact", head: true })
        .in("status", ["failed", "manual_required"]),
    ]);

    return { queue: queue.count ?? 0, failed: failed.count ?? 0 };
  } catch {
    return { queue: 0, failed: 0 };
  }
}

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

  const [scheduled, drafts, published, failed, upcoming, destinationStats] = await Promise.all([
    supabase
      .from("posts")
      .select("*", { count: "exact", head: true })
      .eq("status", "scheduled"),
    supabase
      .from("posts")
      .select("*", { count: "exact", head: true })
      .eq("status", "draft"),
    supabase
      .from("posts")
      .select("*", { count: "exact", head: true })
      .eq("status", "published")
      .gte("published_at", monthStart),
    supabase
      .from("posts")
      .select("*", { count: "exact", head: true })
      .in("status", ["failed", "manual_required"]),
    supabase
      .from("posts")
      .select(POST_SELECT)
      .eq("status", "scheduled")
      .not("scheduled_at", "is", null)
      .order("scheduled_at", { ascending: true })
      .limit(5),
    getDestinationStats(),
  ]);

  if (upcoming.error) throw new Error(upcoming.error.message);

  return {
    counts: {
      scheduled: scheduled.count ?? 0,
      drafts: drafts.count ?? 0,
      publishedThisMonth: published.count ?? 0,
      failed: failed.count ?? 0,
    },
    destinations: {
      total: destinationStats.total,
      selectable: destinationStats.selectable,
    },
    upcoming: await decoratePosts((upcoming.data ?? []) as unknown as Record<string, unknown>[]),
    logs: await listRecentLogs(8),
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

  try {
    settings = await getSettingsRow();
    dbReady = Boolean(settings);
    destinationStats = await getDestinationStats();
  } catch (error) {
    storageError = error instanceof Error ? error.message : "Database check failed";
  }

  const admin = tryCreateAdminClient();
  if (admin) {
    try {
      const bucket = await admin.storage.getBucket("media");
      bucketReady = !bucket.error;
      if (bucket.error) storageError = bucket.error.message;
    } catch (error) {
      storageError = error instanceof Error ? error.message : "Storage check failed";
    }

    const admins = await admin.from("app_admins").select("*", { count: "exact", head: true });
    adminSeeded = (admins.count ?? 0) > 0;
  }

  const expiresAt = settings?.linkedin_token_expires_at
    ? new Date(settings.linkedin_token_expires_at).getTime()
    : null;

  const tokenExpired = Boolean(expiresAt && expiresAt < Date.now());
  const tokenExpiringSoon = Boolean(
    expiresAt && expiresAt >= Date.now() && expiresAt < Date.now() + 7 * 24 * 60 * 60 * 1000,
  );

  const linkedinReady =
    environment.linkedin.configured &&
    Boolean(settings?.linkedin_connected) &&
    Boolean(settings?.linkedin_member_id) &&
    !tokenExpired;

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

export async function listLinkedInAccounts(): Promise<LinkedInAccountRow[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("linkedin_accounts")
    .select("*")
    .order("connected_at", { ascending: false });

  if (error) {
    console.error("Could not load linkedin accounts", error.message);
    return [];
  }
  return data ?? [];
}
