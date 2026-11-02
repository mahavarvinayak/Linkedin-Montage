import type { MediaType, PostRow, PostStatus } from "@/lib/types";

export const POST_COLUMNS = [
  "id",
  "caption",
  "hashtags",
  "media_type",
  "media_paths",
  "scheduled_at",
  "status",
  "attempts",
  "max_attempts",
  "next_attempt_at",
  "last_attempt_at",
  "linkedin_post_id",
  "permalink",
  "last_error",
  "published_at",
  "media_delete_after",
  "media_deleted_at",
  "created_at",
  "updated_at",
].join(", ");

export function normalizePostRow(row: Record<string, unknown>): PostRow {
  const paths = Array.isArray(row.media_paths)
    ? (row.media_paths as unknown[]).filter((value): value is string => typeof value === "string")
    : [];

  return {
    ...(row as unknown as PostRow),
    media_paths: paths,
  };
}

export function mediaTypeFor(paths: string[]): MediaType {
  if (paths.length === 0) return "none";
  if (paths.length === 1) return "image";
  return "images";
}

export function isEditableStatus(status: PostStatus): boolean {
  return status !== "published" && status !== "publishing";
}

export function extractLinkedInPostUrn(permalink: string | null | undefined): string | null {
  if (!permalink) return null;
  let decoded = permalink;
  try {
    decoded = decodeURIComponent(permalink);
  } catch {
    // Keep the original.
  }

  const match = decoded.match(/urn:li:(?:share|ugcPost|activity):\d+/);
  return match ? match[0] : null;
}
