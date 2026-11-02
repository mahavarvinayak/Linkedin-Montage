import { adminClient, assertServiceRole, json, type AdminClient } from "../_shared/supabase.ts";
import { istDateTime, previewText, sendTelegram } from "../_shared/telegram.ts";

type PublishedPost = {
  id: string;
  caption: string;
  hashtags: string;
  media_paths: unknown;
  media_delete_after: string | null;
  published_at: string | null;
  linkedin_post_id: string | null;
};

async function log(
  admin: AdminClient,
  postId: string | null,
  eventType: string,
  message: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await admin.from("publishing_logs").insert({
    post_id: postId,
    event_type: eventType,
    message,
    metadata,
  });
  if (error) console.error("Could not write cleanup log", error.message);
}

function safePaths(post: PublishedPost): string[] {
  if (!Array.isArray(post.media_paths)) return [];
  return post.media_paths.filter(
    (value): value is string =>
      typeof value === "string" && value.startsWith("posts/") && !value.includes(".."),
  );
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!assertServiceRole(req)) return json({ error: "Unauthorized" }, 401);

  const admin = adminClient();
  const now = new Date().toISOString();

  // Only successfully published posts whose retention window has elapsed are
  // eligible. Failed, manual_required, cancelled and draft media is never
  // touched automatically.
  const { data, error } = await admin
    .from("posts")
    .select("id, caption, hashtags, media_paths, media_delete_after, published_at, linkedin_post_id")
    .eq("status", "published")
    .is("media_deleted_at", null)
    .not("media_delete_after", "is", null)
    .lte("media_delete_after", now)
    .limit(50);

  if (error) return json({ error: `Could not load posts for cleanup: ${error.message}` }, 500);

  const posts = (data ?? []) as PublishedPost[];
  const summary = { scanned: posts.length, cleaned: 0, skipped: 0, failed: 0, orphans: 0 };

  for (const post of posts) {
    const paths = safePaths(post);

    // Media is shared by every destination job. Even when the retention clock
    // has elapsed, keep the files while any destination still needs them for a
    // retry or an unresolved outcome.
    const { data: jobs, error: jobsError } = await admin
      .from("publishing_jobs")
      .select("status")
      .eq("post_id", post.id);

    if (jobsError) {
      summary.skipped += 1;
      await log(admin, post.id, "media_cleanup_skipped", jobsError.message);
      continue;
    }

    const jobRows = (jobs ?? []) as { status: string }[];
    const stillNeedsMedia = jobRows.some((job) =>
      ["pending", "scheduled", "publishing", "failed", "manual_required"].includes(job.status),
    );

    if (stillNeedsMedia) {
      summary.skipped += 1;
      await log(
        admin,
        post.id,
        "media_cleanup_skipped",
        "Media retained because at least one destination has not finished publishing.",
      );
      continue;
    }

    if (jobRows.length > 0 && !jobRows.some((job) => job.status === "published")) {
      summary.skipped += 1;
      continue;
    }

    if (paths.length === 0) {
      const { error: updateError } = await admin
        .from("posts")
        .update({ media_deleted_at: now })
        .eq("id", post.id);

      if (updateError) {
        summary.failed += 1;
        await log(admin, post.id, "media_cleanup_failed", updateError.message);
      } else {
        summary.cleaned += 1;
      }
      continue;
    }

    const { error: removeError } = await admin.storage.from("media").remove(paths);

    if (removeError) {
      summary.failed += 1;
      await log(admin, post.id, "media_cleanup_failed", removeError.message, {
        paths,
      });
      continue;
    }

    const { error: updateError } = await admin
      .from("posts")
      .update({ media_deleted_at: now })
      .eq("id", post.id)
      .eq("status", "published");

    if (updateError) {
      summary.failed += 1;
      await log(admin, post.id, "media_cleanup_failed", updateError.message);
      continue;
    }

    summary.cleaned += 1;
    await log(
      admin,
      post.id,
      "media_cleanup",
      `Deleted ${paths.length} media file(s) after the retention window.`,
      { files: paths.length },
    );

    await sendTelegram(
      admin,
      [
        "🧹 LinkedIn media cleanup completed",
        "",
        `Caption: ${previewText(post.caption || "(no caption)")}`,
        `Published: ${post.published_at ? istDateTime(post.published_at) : "unknown"}`,
        `Deleted: ${paths.length} file(s)`,
      ].join("\n"),
    );
  }

  // Orphan sweep: uploads that were never attached to a post (or belonged to a
  // deleted post). Only objects older than 24 hours are removed, and only when
  // no post row references the folder at all.
  const { data: postRows, error: postError } = await admin
    .from("posts")
    .select("id")
    .limit(5000);

  if (!postError) {
    const existing = new Set((postRows ?? []).map((row: { id: string }) => row.id));
    const { data: folders } = await admin.storage.from("media").list("posts", { limit: 1000 });

    for (const folder of folders ?? []) {
      const folderName = folder.name;
      if (!folderName || !/^[0-9a-f-]{36}$/i.test(folderName)) continue;
      if (existing.has(folderName)) continue;

      const { data: objects } = await admin.storage
        .from("media")
        .list(`posts/${folderName}`, { limit: 100 });

      const stale = (objects ?? []).filter((object) => {
        if (!object.created_at) return false;
        return Date.now() - Date.parse(object.created_at) > 24 * 60 * 60 * 1000;
      });

      if (stale.length === 0) continue;

      const { error: removeError } = await admin.storage
        .from("media")
        .remove(stale.map((object) => `posts/${folderName}/${object.name}`));

      if (!removeError) {
        summary.orphans += stale.length;
        await log(
          admin,
          null,
          "orphan_media_cleanup",
          `Deleted ${stale.length} orphaned media file(s).`,
          { folder: folderName },
        );
      }
    }
  }

  return json({ ok: true, ...summary });
});
