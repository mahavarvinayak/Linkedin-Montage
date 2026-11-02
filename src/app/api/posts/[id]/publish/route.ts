import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import {
  apiError,
  getDestinationsByIds,
  getPostJobs,
  getRawPost,
  logEvent,
  refreshPostStatus,
  triggerPublisher,
} from "@/lib/api";
import { composePreviewText } from "@/lib/preview";
import { MAX_CAPTION_LENGTH } from "@/lib/constants";
import { mediaTypeFor } from "@/lib/post-utils";
import { isDestinationSelectable } from "@/lib/destinations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const { id } = await params;

  let body: { confirmUncertain?: boolean; destinationId?: string } = {};
  try {
    body = (await request.json()) as { confirmUncertain?: boolean; destinationId?: string };
  } catch {
    body = {};
  }

  let post;
  let jobs;
  try {
    post = await getRawPost(auth.supabase, id);
    jobs = await getPostJobs(auth.supabase, id);
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Could not load the post.", 500);
  }

  if (!post) return apiError("Post not found.", 404);
  if (post.media_type === "video") {
    return apiError("Video publishing is not enabled in this MVP.", 422);
  }

  if (jobs.length === 0) {
    return apiError("This post has no destinations. Edit it and choose at least one destination.", 409);
  }

  const targets = body.destinationId
    ? jobs.filter((job) => job.id === body.destinationId)
    : jobs.filter((job) => job.status !== "published" && job.status !== "publishing");

  if (body.destinationId && targets.length === 0) {
    return apiError("That destination is not attached to this post.", 404);
  }

  if (targets.length === 0) {
    return apiError("Every destination for this post is already published or publishing.", 409);
  }

  if (targets.some((job) => job.status === "published")) {
    return apiError("A destination that is already published cannot be published again.", 409);
  }

  if (
    targets.some((job) => job.status === "manual_required") &&
    body.confirmUncertain !== true
  ) {
    return apiError(
      "At least one destination needs manual verification. Check LinkedIn first, then confirm the retry.",
      409,
    );
  }

  const commentary = composePreviewText(post.caption, post.hashtags);
  if (!commentary) return apiError("Add a caption before publishing.");
  if (commentary.length > MAX_CAPTION_LENGTH) {
    return apiError(`The caption exceeds LinkedIn’s ${MAX_CAPTION_LENGTH} character limit.`);
  }

  let destinations;
  try {
    destinations = await getDestinationsByIds(
      auth.supabase,
      targets.map((job) => job.destination_id),
    );
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Could not load destinations.", 500);
  }

  const byId = new Map(destinations.map((destination) => [destination.id, destination]));
  const blocked: string[] = [];

  for (const job of targets) {
    const destination = byId.get(job.destination_id);
    if (!destination) {
      blocked.push(`a destination that no longer exists (${job.author_urn})`);
    } else if (!isDestinationSelectable(destination)) {
      blocked.push(destination.name);
    }
  }

  if (blocked.length > 0) {
    return apiError(
      `${blocked.join(", ")} cannot publish right now. Refresh destinations in Settings or reconnect LinkedIn.`,
      409,
    );
  }

  const { data: settings } = await auth.supabase
    .from("settings")
    .select("linkedin_connected, linkedin_member_id")
    .eq("id", 1)
    .maybeSingle();

  if (!settings?.linkedin_connected || !settings.linkedin_member_id) {
    return apiError(
      "LinkedIn is not connected. Connect your account in Settings, or use the manual publishing option.",
      409,
    );
  }

  const now = new Date().toISOString();
  const targetIds = targets.map((job) => job.id);

  const { error: jobError } = await auth.supabase
    .from("publishing_jobs")
    .update({
      status: "scheduled",
      scheduled_at: now,
      next_attempt_at: now,
      attempts: 0,
      last_attempt_at: null,
      last_error: null,
      locked_at: null,
      lock_token: null,
    })
    .in("id", targetIds);

  if (jobError) {
    return apiError(`Could not queue the destination jobs: ${jobError.message}`, 500);
  }

  const { data, error } = await auth.supabase
    .from("posts")
    .update({
      status: "scheduled",
      scheduled_at: now,
      next_attempt_at: null,
      attempts: 0,
      last_error: null,
      media_type: mediaTypeFor(post.media_paths),
      locked_at: null,
      lock_token: null,
    })
    .eq("id", id)
    .eq("status", post.status)
    .select("id, status")
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return apiError(
        "This post changed while the request was made — it may already be publishing or published. Refresh before trying again.",
        409,
      );
    }
    return apiError(`Could not queue the post: ${error.message}`, 500);
  }

  await refreshPostStatus(auth.supabase, id);

  await logEvent(
    auth.supabase,
    id,
    "publish_requested",
    body.destinationId
      ? `Immediate publishing requested for ${byId.get(targets[0].destination_id)?.name ?? "one destination"}.`
      : `Immediate publishing requested for ${targets.length} destination${targets.length === 1 ? "" : "s"}.`,
    { destinations: targetIds },
  );

  const result = await triggerPublisher(id);

  return NextResponse.json(
    {
      ok: true,
      post: data,
      queued: true,
      destinations: targets.length,
      triggered: result.triggered,
      warning: result.triggered
        ? null
        : `Queued for the next scheduler run${result.error ? ` (${result.error})` : ""}.`,
    },
    { status: 202 },
  );
}
