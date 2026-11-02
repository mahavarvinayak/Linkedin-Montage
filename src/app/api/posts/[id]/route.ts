import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import {
  apiError,
  getDestinationsByIds,
  getPostJobs,
  getRawPost,
  logEvent,
  parseScheduledAt,
  refreshPostStatus,
  removeMediaObjects,
  safeMediaPath,
} from "@/lib/api";
import { updatePostSchema, zodMessage } from "@/lib/validation";
import { isEditableStatus, mediaTypeFor, POST_COLUMNS } from "@/lib/post-utils";
import { composePreviewText } from "@/lib/preview";
import { MAX_CAPTION_LENGTH } from "@/lib/constants";
import { isDestinationSelectable } from "@/lib/destinations";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  try {
    const post = await getRawPost(auth.supabase, id);
    if (!post) return apiError("Post not found.", 404);
    return NextResponse.json({ post });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Could not load the post.", 500);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid JSON body.");
  }

  const parsed = updatePostSchema.safeParse(body);
  if (!parsed.success) return apiError(zodMessage(parsed.error));

  let post;
  try {
    post = await getRawPost(auth.supabase, id);
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Could not load the post.", 500);
  }

  if (!post) return apiError("Post not found.", 404);
  if (!isEditableStatus(post.status)) {
    return apiError("Published or in-flight posts cannot be edited.", 409);
  }

  const caption = parsed.data.caption ?? post.caption;
  const hashtags = parsed.data.hashtags ?? post.hashtags;
  const mediaPaths = parsed.data.mediaPaths ?? post.media_paths;
  const nextStatus = parsed.data.status ?? post.status;
  const scheduleWasProvided = parsed.data.scheduledAt !== undefined;
  const requestedDestinations = parsed.data.destinationIds
    ? [...new Set(parsed.data.destinationIds)]
    : null;

  const scheduled = parseScheduledAt(
    scheduleWasProvided ? parsed.data.scheduledAt : post.scheduled_at,
    {
      mustBeFuture:
        nextStatus === "scheduled" &&
        (post.status !== "scheduled" || scheduleWasProvided),
    },
  );

  if (scheduled.error) return apiError(scheduled.error);
  if (nextStatus === "scheduled" && !scheduled.iso) {
    return apiError("Choose a date and time before scheduling.");
  }

  if (mediaPaths.some((path) => !safeMediaPath(path, id))) {
    return apiError("One or more media paths do not belong to this post.");
  }

  if (nextStatus === "scheduled" && !composePreviewText(caption, hashtags)) {
    return apiError("A scheduled post needs a caption.");
  }

  if (composePreviewText(caption, hashtags).length > MAX_CAPTION_LENGTH) {
    return apiError(`The caption and hashtags exceed LinkedIn’s ${MAX_CAPTION_LENGTH} character limit.`);
  }

  let jobs;
  let destinationsForJobs;
  try {
    jobs = await getPostJobs(auth.supabase, id);

    if (requestedDestinations !== null) {
      destinationsForJobs = await getDestinationsByIds(auth.supabase, requestedDestinations);

      if (destinationsForJobs.length !== requestedDestinations.length) {
        return apiError("One or more destinations no longer exist. Refresh the destination list.");
      }
    } else {
      destinationsForJobs = await getDestinationsByIds(
        auth.supabase,
        jobs.map((job) => job.destination_id),
      );
    }
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Could not load destinations.", 500);
  }

  const destinationName = new Map(destinationsForJobs.map((row) => [row.id, row.name]));

  if (nextStatus === "scheduled") {
    if (destinationsForJobs.length === 0) {
      return apiError("Choose at least one destination before scheduling.");
    }

    const blocked = destinationsForJobs.filter((destination) => !isDestinationSelectable(destination));
    if (blocked.length > 0) {
      return apiError(
        `${blocked.map((destination) => destination.name).join(", ")} ${
          blocked.length === 1 ? "is" : "are"
        } not authorized for publishing. Refresh destinations or reconnect LinkedIn.`,
        409,
      );
    }
  }

  if (requestedDestinations !== null) {
    const removable = jobs.filter((job) => !requestedDestinations.includes(job.destination_id));
    const locked = removable.filter(
      (job) => job.status === "publishing" || job.status === "published",
    );

    if (locked.length > 0) {
      return apiError(
        `${locked
          .map((job) => destinationName.get(job.destination_id) ?? "A destination")
          .join(", ")} already published or is publishing, so it cannot be removed from this post.`,
        409,
      );
    }
  }

  const removed = post.media_paths.filter((path) => !mediaPaths.includes(path));

  const resetAttempts =
    nextStatus === "scheduled" &&
    (post.status !== "scheduled" || scheduleWasProvided);

  const updates: Record<string, unknown> = {
    caption,
    hashtags,
    media_paths: mediaPaths,
    media_type: mediaTypeFor(mediaPaths),
    scheduled_at: scheduled.iso,
    status: nextStatus,
  };

  if (nextStatus === "scheduled" || nextStatus === "draft") {
    updates.next_attempt_at = null;
    updates.locked_at = null;
    updates.lock_token = null;
  }

  if (nextStatus === "scheduled") {
    updates.last_error = null;
  }

  if (resetAttempts) updates.attempts = 0;
  if (nextStatus === "cancelled") updates.next_attempt_at = null;

  const { data, error } = await auth.supabase
    .from("posts")
    .update(updates)
    .eq("id", id)
    .eq("status", post.status)
    .select(POST_COLUMNS)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return apiError(
        "This post changed while you were editing it — it may be publishing or already published. Refresh and try again.",
        409,
      );
    }
    return apiError(`Could not update the post: ${error.message}`, 500);
  }

  // ------------------------------------------------------------------
  // Reconcile per-destination jobs with the new selection and schedule.
  // ------------------------------------------------------------------
  try {
    if (requestedDestinations !== null) {
      const existingIds = new Set(jobs.map((job) => job.destination_id));
      const removals = jobs.filter((job) => !requestedDestinations.includes(job.destination_id));
      const additions = (destinationsForJobs ?? []).filter(
        (destination) => !existingIds.has(destination.id),
      );

      if (removals.length > 0) {
        const { error: removeError } = await auth.supabase
          .from("publishing_jobs")
          .delete()
          .in("id", removals.map((job) => job.id));

        if (removeError) throw new Error(removeError.message);
      }

      if (additions.length > 0) {
        const jobStatus = nextStatus === "scheduled" ? "scheduled" : "pending";
        const { error: addError } = await auth.supabase.from("publishing_jobs").insert(
          additions.map((destination) => ({
            post_id: id,
            destination_id: destination.id,
            author_urn: destination.author_urn,
            status: jobStatus,
            scheduled_at: nextStatus === "scheduled" ? scheduled.iso : null,
          })),
        );

        if (addError) throw new Error(addError.message);
      }
    }

    if (nextStatus === "cancelled") {
      const { error: cancelError } = await auth.supabase
        .from("publishing_jobs")
        .update({
          status: "cancelled",
          next_attempt_at: null,
          locked_at: null,
          lock_token: null,
        })
        .eq("post_id", id)
        .in("status", ["pending", "scheduled", "failed", "manual_required"]);

      if (cancelError) throw new Error(cancelError.message);
    } else if (nextStatus === "scheduled") {
      const { error: scheduleError } = await auth.supabase
        .from("publishing_jobs")
        .update({
          status: "scheduled",
          scheduled_at: scheduled.iso,
          next_attempt_at: null,
          last_error: null,
          locked_at: null,
          lock_token: null,
          ...(resetAttempts ? { attempts: 0, last_attempt_at: null } : {}),
        })
        .eq("post_id", id)
        .in("status", ["pending", "scheduled", "failed", "manual_required", "cancelled"]);

      if (scheduleError) throw new Error(scheduleError.message);
    } else if (nextStatus === "draft") {
      const { error: draftError } = await auth.supabase
        .from("publishing_jobs")
        .update({
          status: "pending",
          scheduled_at: null,
          next_attempt_at: null,
          last_error: null,
          locked_at: null,
          lock_token: null,
          attempts: 0,
        })
        .eq("post_id", id)
        .in("status", ["scheduled", "failed", "manual_required", "cancelled"]);

      if (draftError) throw new Error(draftError.message);
    }

    await refreshPostStatus(auth.supabase, id);
  } catch (jobError) {
    const message = jobError instanceof Error ? jobError.message : "Could not update publishing jobs.";
    await logEvent(auth.supabase, id, "job_reconcile_failed", message);
    return apiError(`The post was saved, but its destination jobs could not be updated: ${message}`, 500);
  }

  // Delete objects only after the row update succeeded, so a lost race never
  // removes media that the current row still references.
  const cleanupError = await removeMediaObjects(removed);

  if (cleanupError) {
    await logEvent(auth.supabase, id, "media_delete_failed", cleanupError, { removed });
  }

  const eventType =
    nextStatus === "cancelled"
      ? "post_cancelled"
      : post.status !== "scheduled" && nextStatus === "scheduled"
        ? "post_scheduled"
        : scheduleWasProvided && scheduled.iso !== post.scheduled_at
          ? "post_rescheduled"
          : "post_updated";

  const message =
    eventType === "post_cancelled"
      ? "Post cancelled."
      : eventType === "post_scheduled"
        ? `Post scheduled for ${scheduled.iso}.`
        : eventType === "post_rescheduled"
          ? `Post moved to ${scheduled.iso}.`
          : "Post details updated.";

  await logEvent(auth.supabase, id, eventType, message, {
    previous_status: post.status,
    status: nextStatus,
    destinations: (destinationsForJobs ?? []).map((destination) => destination.author_urn),
  });

  const { data: refreshed } = await auth.supabase
    .from("posts")
    .select(POST_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  return NextResponse.json({ post: refreshed ?? data });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const { id } = await params;

  let post;
  try {
    post = await getRawPost(auth.supabase, id);
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Could not load the post.", 500);
  }

  if (!post) return apiError("Post not found.", 404);
  if (post.status !== "draft" && post.status !== "cancelled") {
    return apiError("Only drafts and cancelled posts can be deleted.", 409);
  }

  const { data: deleted, error } = await auth.supabase
    .from("posts")
    .delete()
    .eq("id", id)
    .eq("status", post.status)
    .select("id");

  if (error) return apiError(`Could not delete the post: ${error.message}`, 500);
  if (!deleted || deleted.length === 0) {
    return apiError("This post changed while it was being deleted. Refresh and try again.", 409);
  }

  const cleanupError = await removeMediaObjects(post.media_paths);
  await logEvent(auth.supabase, null, "post_deleted", "Post deleted.", {
    caption: post.caption.slice(0, 200),
    cleanup_error: cleanupError,
  });

  return NextResponse.json({ ok: true });
}
