import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import {
  apiError,
  getDestinationsByIds,
  getPostJobs,
  getRawPost,
  logEvent,
  refreshPostStatus,
} from "@/lib/api";
import { manualPublishedSchema, zodMessage } from "@/lib/validation";
import { extractLinkedInPostUrn } from "@/lib/post-utils";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const { id } = await params;

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const parsed = manualPublishedSchema.safeParse(body);
  if (!parsed.success) return apiError(zodMessage(parsed.error));

  let post;
  let jobs;
  try {
    post = await getRawPost(auth.supabase, id);
    jobs = await getPostJobs(auth.supabase, id);
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Could not load the post.", 500);
  }

  if (!post) return apiError("Post not found.", 404);

  const targets = parsed.data.destinationId
    ? jobs.filter((job) => job.destination_id === parsed.data.destinationId)
    : jobs.filter((job) => job.status === "failed" || job.status === "manual_required");

  if (parsed.data.destinationId && targets.length === 0) {
    return apiError("That destination is not attached to this post.", 404);
  }

  if (targets.length === 0) {
    return apiError(
      "Only destinations that failed or need attention can be marked as published.",
      409,
    );
  }

  if (targets.some((job) => job.status === "published")) {
    return apiError("That destination is already recorded as published.", 409);
  }

  const now = new Date().toISOString();
  const permalink = parsed.data.permalink || null;
  const postUrn = extractLinkedInPostUrn(permalink);

  const { error: jobError } = await auth.supabase
    .from("publishing_jobs")
    .update({
      status: "published",
      published_at: now,
      permalink,
      linkedin_post_id: postUrn,
      last_error: null,
      next_attempt_at: null,
      locked_at: null,
      lock_token: null,
    })
    .in("id", targets.map((job) => job.id));

  if (jobError) {
    return apiError(`Could not mark the destination as published: ${jobError.message}`, 500);
  }

  await refreshPostStatus(auth.supabase, id);

  let names: string[] = [];
  try {
    const destinations = await getDestinationsByIds(
      auth.supabase,
      targets.map((job) => job.destination_id),
    );
    names = destinations.map((destination) => destination.name);
  } catch {
    names = [];
  }

  await logEvent(
    auth.supabase,
    id,
    "manual_published",
    `Marked ${names.length > 0 ? names.join(", ") : `${targets.length} destination(s)`} as published manually. LinkedIn did not confirm this through the API.`,
    { permalink, linkedin_post_id: postUrn, destinations: targets.map((job) => job.id) },
  );

  const { data } = await auth.supabase
    .from("posts")
    .select("id, status, permalink, published_at")
    .eq("id", id)
    .maybeSingle();

  return NextResponse.json({ post: data, marked: targets.length });
}
