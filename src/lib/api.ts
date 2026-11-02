import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseEnv } from "@/lib/env";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import { normalizePostRow, POST_COLUMNS } from "@/lib/post-utils";
import type { DestinationRow, PostRow } from "@/lib/types";

export type PostJobRow = {
  id: string;
  post_id: string;
  destination_id: string;
  author_urn: string;
  status: string;
  scheduled_at: string | null;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string | null;
  last_attempt_at: string | null;
  published_at: string | null;
  linkedin_post_id: string | null;
  permalink: string | null;
  last_error: string | null;
};

export function apiError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function logEvent(
  supabase: SupabaseClient,
  postId: string | null,
  eventType: string,
  message: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await supabase.from("publishing_logs").insert({
    post_id: postId,
    event_type: eventType,
    message,
    metadata,
  });

  if (error) console.error("Could not write publishing log", error.message);
}

export async function getRawPost(
  supabase: SupabaseClient,
  id: string,
): Promise<PostRow | null> {
  const { data, error } = await supabase.from("posts").select(POST_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return normalizePostRow(data as unknown as Record<string, unknown>);
}

export function parseScheduledAt(
  value: string | null | undefined,
  options: { mustBeFuture?: boolean } = {},
): { iso: string | null; error?: string } {
  if (value === null || value === undefined || value === "") {
    return { iso: null };
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return { iso: null, error: "Choose a valid schedule date and time." };
  }

  if (options.mustBeFuture && date.getTime() < Date.now() - 60_000) {
    return { iso: null, error: "The scheduled time must be in the future." };
  }

  return { iso: date.toISOString() };
}

export function safeMediaPath(path: string, postId: string): boolean {
  return path.startsWith(`posts/${postId}/`) && !path.includes("..");
}

export async function removeMediaObjects(paths: string[]): Promise<string | null> {
  if (paths.length === 0) return null;
  const admin = tryCreateAdminClient();
  if (!admin) return "Supabase service role is not configured";

  const { error } = await admin.storage.from("media").remove(paths);
  return error?.message ?? null;
}

/**
 * Recomputes the post-level status, timestamps and media lifecycle from its
 * per-destination jobs. Safe to call after any job mutation.
 */
export async function refreshPostStatus(supabase: SupabaseClient, postId: string): Promise<void> {
  const { error } = await supabase.rpc("admin_refresh_post_status", { p_post_id: postId });
  if (error) console.error("Could not refresh post status", postId, error.message);
}

export async function getPostJobs(
  supabase: SupabaseClient,
  postId: string,
): Promise<PostJobRow[]> {
  const { data, error } = await supabase
    .from("publishing_jobs")
    .select(
      "id, post_id, destination_id, author_urn, status, scheduled_at, attempts, max_attempts, next_attempt_at, last_attempt_at, published_at, linkedin_post_id, permalink, last_error",
    )
    .eq("post_id", postId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as PostJobRow[];
}

export async function getDestinationsByIds(
  supabase: SupabaseClient,
  ids: string[],
): Promise<DestinationRow[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];

  const { data, error } = await supabase
    .from("linkedin_destinations")
    .select("*")
    .in("id", unique);

  if (error) throw new Error(error.message);
  return (data ?? []) as DestinationRow[];
}

/**
 * Best-effort immediate trigger. The one-minute cron remains the source of
 * truth, so a failed invocation only means the post publishes on the next tick.
 */
export async function triggerPublisher(postId?: string): Promise<{ triggered: boolean; error?: string }> {
  const { url, serviceRoleKey } = getSupabaseEnv();
  if (!url || !serviceRoleKey) {
    return { triggered: false, error: "Supabase service role is not configured." };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  try {
    const response = await fetch(`${url.replace(/\/+$/, "")}/functions/v1/publish-scheduled`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify(postId ? { postId } : {}),
      signal: controller.signal,
      cache: "no-store",
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return {
        triggered: false,
        error: `Worker returned ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
      };
    }

    return { triggered: true };
  } catch (error) {
    return {
      triggered: false,
      error:
        error instanceof Error && error.name === "AbortError"
          ? "The worker did not respond in time; it will be retried by cron."
          : error instanceof Error
            ? error.message
            : "Could not reach the publishing worker.",
    };
  } finally {
    clearTimeout(timeout);
  }
}
