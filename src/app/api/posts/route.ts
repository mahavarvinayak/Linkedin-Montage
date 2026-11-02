import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import {
  apiError,
  getDestinationsByIds,
  logEvent,
  parseScheduledAt,
  refreshPostStatus,
} from "@/lib/api";
import { createPostSchema, zodMessage } from "@/lib/validation";
import { mediaTypeFor, POST_COLUMNS } from "@/lib/post-utils";
import { listPosts } from "@/lib/queries";
import { composePreviewText } from "@/lib/preview";
import { MAX_CAPTION_LENGTH } from "@/lib/constants";
import { POST_STATUSES, type PostStatus } from "@/lib/types";
import { isDestinationSelectable } from "@/lib/destinations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const statusParam = searchParams.get("status");
  const statuses = (statusParam ? statusParam.split(",") : ["draft", "scheduled", "publishing"])
    .map((value) => value.trim())
    .filter((value): value is PostStatus => (POST_STATUSES as readonly string[]).includes(value));

  if (statuses.length === 0) return apiError("No valid status filter provided.");

  try {
    const posts = await listPosts(statuses, { limit: 100 });
    return NextResponse.json({ posts });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Could not load posts.", 500);
  }
}

export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid JSON body.");
  }

  const parsed = createPostSchema.safeParse(body);
  if (!parsed.success) return apiError(zodMessage(parsed.error));

  const { caption, hashtags, mediaPaths } = parsed.data;
  const status = parsed.data.status;
  const destinationIds = [...new Set(parsed.data.destinationIds)];
  const scheduled = parseScheduledAt(parsed.data.scheduledAt, {
    mustBeFuture: status === "scheduled",
  });

  if (scheduled.error) return apiError(scheduled.error);

  if (status === "scheduled" && !scheduled.iso) {
    return apiError("Choose a date and time before scheduling.");
  }

  if (status === "scheduled" && destinationIds.length === 0) {
    return apiError("Choose at least one destination before scheduling.");
  }

  const commentary = composePreviewText(caption, hashtags);
  if (status === "scheduled" && !commentary) {
    return apiError("A scheduled post needs a caption.");
  }

  if (commentary.length > MAX_CAPTION_LENGTH) {
    return apiError(`The caption and hashtags exceed LinkedIn’s ${MAX_CAPTION_LENGTH} character limit.`);
  }

  if (mediaPaths.some((path) => !path.startsWith("posts/") || path.includes(".."))) {
    return apiError("One or more media paths are invalid.");
  }

  // Media is uploaded against the post ID after creation. A new post cannot
  // legitimately reference existing objects, so reject pre-supplied paths.
  if (mediaPaths.length > 0) {
    return apiError("Create the post first, then upload its images.");
  }

  let destinations;
  try {
    destinations = await getDestinationsByIds(auth.supabase, destinationIds);
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Could not load destinations.", 500);
  }

  if (destinations.length !== destinationIds.length) {
    return apiError("One or more destinations no longer exist. Refresh the destination list.");
  }

  if (status === "scheduled") {
    const blocked = destinations.filter((destination) => !isDestinationSelectable(destination));
    if (blocked.length > 0) {
      return apiError(
        `${blocked.map((destination) => destination.name).join(", ")} ${
          blocked.length === 1 ? "is" : "are"
        } not authorized for publishing. Refresh destinations or reconnect LinkedIn.`,
        409,
      );
    }
  }

  const { data, error } = await auth.supabase
    .from("posts")
    .insert({
      caption,
      hashtags,
      media_paths: mediaPaths,
      media_type: mediaTypeFor(mediaPaths),
      scheduled_at: scheduled.iso,
      status,
    })
    .select(POST_COLUMNS)
    .single();

  if (error) return apiError(`Could not create the post: ${error.message}`, 500);

  const created = data as unknown as { id: string } | null;
  if (!created) return apiError("The post was created but no ID was returned.", 500);

  if (destinations.length > 0) {
    const jobStatus = status === "scheduled" ? "scheduled" : "pending";
    const { error: jobError } = await auth.supabase.from("publishing_jobs").insert(
      destinations.map((destination) => ({
        post_id: created.id,
        destination_id: destination.id,
        author_urn: destination.author_urn,
        status: jobStatus,
        scheduled_at: status === "scheduled" ? scheduled.iso : null,
      })),
    );

    if (jobError) {
      // No partial state: a post without its jobs would never publish.
      await auth.supabase.from("posts").delete().eq("id", created.id);
      return apiError(`Could not create the publishing jobs: ${jobError.message}`, 500);
    }

    await refreshPostStatus(auth.supabase, created.id);
  }

  await logEvent(
    auth.supabase,
    created.id,
    status === "scheduled" ? "post_scheduled" : "post_created",
    status === "scheduled"
      ? `Post scheduled for ${destinations.length} destination${destinations.length === 1 ? "" : "s"}.`
      : "Draft created.",
    { destinations: destinations.map((destination) => destination.author_urn) },
  );

  const { data: refreshed } = await auth.supabase
    .from("posts")
    .select(POST_COLUMNS)
    .eq("id", created.id)
    .maybeSingle();

  return NextResponse.json({ post: refreshed ?? data }, { status: 201 });
}
