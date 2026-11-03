import fs from "node:fs";
import path from "node:path";
import { adminClient } from "./db";

export { TOOLS, type ToolDefinition } from "./definitions";

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function parseDateTimeToIso(input: string): string {
  const trimmed = input.trim();
  // If standard ISO string with timezone or Z
  if (trimmed.includes("Z") || /[+-]\d{2}:\d{2}$/.test(trimmed)) {
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) return d.toISOString();
  }

  // Treat as IST (UTC + 05:30)
  // Format: YYYY-MM-DD or YYYY-MM-DD HH:MM or YYYY-MM-DDTHH:MM:SS
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(trimmed);
  if (match) {
    const [, yr, mo, dy, hr = "10", min = "00", sec = "00"] = match;
    const istIso = `${yr}-${mo}-${dy}T${hr}:${min}:${sec}+05:30`;
    const d = new Date(istIso);
    if (!isNaN(d.getTime())) return d.toISOString();
  }

  const fallback = new Date(trimmed);
  if (!isNaN(fallback.getTime())) return fallback.toISOString();

  throw new Error(`Invalid date/time format: "${input}". Use ISO 8601 or 'YYYY-MM-DD HH:MM'.`);
}

async function getSelectableDestinations(specifiedIds?: string[]) {
  let query = adminClient
    .from("linkedin_destinations")
    .select("id, author_urn, name, destination_type, status, is_enabled, publish_authorized");

  if (specifiedIds && specifiedIds.length > 0) {
    query = query
      .in("id", specifiedIds)
      .eq("is_enabled", true)
      .eq("publish_authorized", true)
      .in("status", ["available", "unverified"]);
  } else {
    query = query.eq("is_enabled", true).eq("publish_authorized", true).in("status", ["available", "unverified"]);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Could not fetch destinations: ${error.message}`);

  const rows = data ?? [];

  if (specifiedIds && specifiedIds.length > 0) {
    const found = new Set(rows.map((row) => row.id as string));
    const missing = specifiedIds.filter((id) => !found.has(id));
    if (missing.length > 0) {
      throw new Error(
        `These destinations are not ready to publish (disabled, unauthorized or missing): ${missing.join(", ")}. Run cadence_list_destinations to see ready IDs.`,
      );
    }
  }

  return rows;
}

async function syncJobsForPost(postId: string, destinationIds: string[], scheduledAt: string | null, isDraft = false) {
  const destinations = await getSelectableDestinations(destinationIds);
  if (destinations.length === 0) {
    throw new Error("No ready destinations found matching the specified destination IDs.");
  }

  // Delete jobs that are no longer selected and not yet published
  await adminClient
    .from("publishing_jobs")
    .delete()
    .eq("post_id", postId)
    .not("status", "in", '("published","publishing")')
    .not("destination_id", "in", `(${destinations.map((d) => `"${d.id}"`).join(",")})`);

  // Never overwrite a job that already published: a reschedule must not
  // duplicate a LinkedIn post.
  const { data: existingJobs, error: existingError } = await adminClient
    .from("publishing_jobs")
    .select("destination_id, status")
    .eq("post_id", postId);

  if (existingError) throw new Error(existingError.message);

  const lockedDestinations = new Set(
    (existingJobs ?? [])
      .filter((job) => job.status === "published" || job.status === "publishing")
      .map((job) => job.destination_id as string),
  );

  for (const dest of destinations) {
    if (lockedDestinations.has(dest.id)) continue;

    const status = isDraft ? "pending" : "scheduled";
    const { error } = await adminClient.from("publishing_jobs").upsert(
      {
        post_id: postId,
        destination_id: dest.id,
        author_urn: dest.author_urn,
        status,
        scheduled_at: isDraft ? null : scheduledAt,
        next_attempt_at: isDraft ? null : scheduledAt,
        attempts: 0,
        last_attempt_at: null,
        last_error: null,
        locked_at: null,
        lock_token: null,
      },
      { onConflict: "post_id, destination_id" },
    );
    if (error) throw new Error(`Could not create publishing job for ${dest.name}: ${error.message}`);
  }

  await adminClient.rpc("admin_refresh_post_status", { p_post_id: postId });
}

// ----------------------------------------------------------------------------
// Tool Handlers
// ----------------------------------------------------------------------------

export async function executeTool(name: string, args: Record<string, any>): Promise<any> {
  switch (name) {
    case "cadence_get_status": {
      const [postsCount, accounts, destinations, nextPost] = await Promise.all([
        adminClient.from("posts").select("status"),
        adminClient.from("linkedin_accounts").select("id, member_urn, name, status, token_expires_at"),
        adminClient.from("linkedin_destinations").select("id, name, destination_type, status, is_enabled, publish_authorized"),
        adminClient
          .from("posts")
          .select("id, caption, scheduled_at")
          .eq("status", "scheduled")
          .gt("scheduled_at", new Date().toISOString())
          .order("scheduled_at", { ascending: true })
          .limit(1)
          .maybeSingle(),
      ]);

      const statusMap: Record<string, number> = {
        draft: 0,
        scheduled: 0,
        publishing: 0,
        published: 0,
        failed: 0,
        manual_required: 0,
        cancelled: 0,
      };

      for (const row of postsCount.data ?? []) {
        if (row.status in statusMap) statusMap[row.status] += 1;
      }

      return {
        healthy: true,
        queue: statusMap,
        total_posts: postsCount.data?.length ?? 0,
        connected_accounts: accounts.data ?? [],
        total_accounts: accounts.data?.length ?? 0,
        destinations: {
          total: destinations.data?.length ?? 0,
          ready: (destinations.data ?? []).filter((d) => d.is_enabled && d.publish_authorized && d.status === "available").length,
          disabled: (destinations.data ?? []).filter((d) => !d.is_enabled).length,
        },
        next_scheduled_post: nextPost.data ?? null,
      };
    }

    case "cadence_list_destinations": {
      let query = adminClient
        .from("linkedin_destinations")
        .select("id, author_urn, name, destination_type, status, status_detail, is_enabled, publish_authorized, account_urn")
        .order("name", { ascending: true });

      if (args.enabled_only) {
        query = query.eq("is_enabled", true).eq("publish_authorized", true).in("status", ["available", "unverified"]);
      }

      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return { destinations: data ?? [] };
    }

    case "cadence_list_accounts": {
      const { data, error } = await adminClient
        .from("linkedin_accounts")
        .select("id, member_urn, name, picture, status, scopes, token_expires_at, connected_at")
        .order("connected_at", { ascending: false });

      if (error) throw new Error(error.message);
      return { accounts: data ?? [] };
    }

    case "cadence_list_posts": {
      const limit = Math.min(100, Math.max(1, args.limit || 20));
      const offset = Math.max(0, args.offset || 0);

      let query = adminClient
        .from("posts")
        .select(
          `id, caption, hashtags, media_type, media_paths, scheduled_at, status, attempts, published_at, permalink, last_error, created_at,
           publishing_jobs(id, destination_id, author_urn, status, scheduled_at, published_at, permalink, last_error)`
        )
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (args.status && args.status !== "all") {
        query = query.eq("status", args.status);
      }

      if (args.search) {
        query = query.or(`caption.ilike.%${args.search}%,hashtags.ilike.%${args.search}%`);
      }

      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return { posts: data ?? [], limit, offset };
    }

    case "cadence_get_post": {
      const { data: post, error } = await adminClient
        .from("posts")
        .select(
          `id, caption, hashtags, media_type, media_paths, scheduled_at, status, attempts, published_at, permalink, last_error, created_at,
           publishing_jobs(id, destination_id, author_urn, status, scheduled_at, published_at, permalink, last_error,
             destination:linkedin_destinations(id, name, destination_type))`
        )
        .eq("id", args.post_id)
        .maybeSingle();

      if (error) throw new Error(error.message);
      if (!post) throw new Error(`Post not found with ID ${args.post_id}`);

      const { data: logs } = await adminClient
        .from("publishing_logs")
        .select("id, event_type, message, metadata, created_at")
        .eq("post_id", args.post_id)
        .order("created_at", { ascending: false })
        .limit(20);

      return { post, logs: logs ?? [] };
    }

    case "cadence_create_draft": {
      const mediaPaths = Array.isArray(args.media_paths) ? args.media_paths : [];
      const mediaType = mediaPaths.length === 0 ? "none" : mediaPaths.length === 1 ? "image" : "images";

      const { data: post, error } = await adminClient
        .from("posts")
        .insert({
          caption: args.caption.trim(),
          hashtags: (args.hashtags || "").trim(),
          media_type: mediaType,
          media_paths: mediaPaths,
          status: "draft",
          scheduled_at: null,
        })
        .select()
        .single();

      if (error) throw new Error(error.message);

      await syncJobsForPost(post.id, args.destination_ids, null, true);
      return { ok: true, post_id: post.id, status: "draft", message: "Draft post created successfully." };
    }

    case "cadence_schedule_post": {
      const scheduledIso = parseDateTimeToIso(args.scheduled_at);
      const mediaPaths = Array.isArray(args.media_paths) ? args.media_paths : [];
      const mediaType = mediaPaths.length === 0 ? "none" : mediaPaths.length === 1 ? "image" : "images";

      let postId = args.post_id;

      if (postId) {
        const { data: current, error: currentError } = await adminClient
          .from("posts")
          .select("status")
          .eq("id", postId)
          .maybeSingle();

        if (currentError) throw new Error(currentError.message);
        if (!current) throw new Error(`Post not found with ID ${postId}.`);
        if (current.status === "publishing" || current.status === "published") {
          throw new Error(
            `Post ${postId} is ${current.status} and cannot be scheduled again. Use cadence_retry_job for a failed destination.`,
          );
        }

        const updateData: Record<string, any> = {
          scheduled_at: scheduledIso,
          status: "scheduled",
          attempts: 0,
          next_attempt_at: null,
          last_error: null,
          locked_at: null,
          lock_token: null,
        };
        if (args.caption !== undefined) updateData.caption = args.caption.trim();
        if (args.hashtags !== undefined) updateData.hashtags = args.hashtags.trim();
        if (args.media_paths !== undefined) {
          updateData.media_paths = mediaPaths;
          updateData.media_type = mediaType;
        }

        const { error } = await adminClient.from("posts").update(updateData).eq("id", postId);
        if (error) throw new Error(error.message);
      } else {
        if (!args.caption) throw new Error("Caption is required when creating a new scheduled post.");

        const { data: post, error } = await adminClient
          .from("posts")
          .insert({
            caption: args.caption.trim(),
            hashtags: (args.hashtags || "").trim(),
            media_type: mediaType,
            media_paths: mediaPaths,
            status: "scheduled",
            scheduled_at: scheduledIso,
          })
          .select()
          .single();

        if (error) throw new Error(error.message);
        postId = post.id;
      }

      await syncJobsForPost(postId, args.destination_ids, scheduledIso, false);
      return { ok: true, post_id: postId, scheduled_at: scheduledIso, status: "scheduled" };
    }

    case "cadence_bulk_schedule": {
      const postsInput = args.posts;
      if (!Array.isArray(postsInput) || postsInput.length === 0) {
        throw new Error("Expected a non-empty array of posts.");
      }

      const scheduledResults = [];

      for (const p of postsInput) {
        const scheduledIso = parseDateTimeToIso(p.scheduled_at);
        const mediaPaths = Array.isArray(p.media_paths) ? p.media_paths : [];
        const mediaType = mediaPaths.length === 0 ? "none" : mediaPaths.length === 1 ? "image" : "images";

        const { data: post, error } = await adminClient
          .from("posts")
          .insert({
            caption: p.caption.trim(),
            hashtags: (p.hashtags || "").trim(),
            media_type: mediaType,
            media_paths: mediaPaths,
            status: "scheduled",
            scheduled_at: scheduledIso,
          })
          .select()
          .single();

        if (error) throw new Error(`Error inserting post: ${error.message}`);

        await syncJobsForPost(post.id, p.destination_ids, scheduledIso, false);
        scheduledResults.push({
          post_id: post.id,
          caption: p.caption.slice(0, 40) + "...",
          scheduled_at: scheduledIso,
        });
      }

      return {
        ok: true,
        count: scheduledResults.length,
        scheduled_posts: scheduledResults,
      };
    }

    case "cadence_upload_media": {
      let fileBuffer: Buffer;
      let targetFilename = args.filename;

      if (args.file_path) {
        const resolvedPath = path.resolve(args.file_path);
        if (!fs.existsSync(resolvedPath)) {
          throw new Error(`File does not exist at path: ${resolvedPath}`);
        }
        fileBuffer = fs.readFileSync(resolvedPath);
        if (!targetFilename) targetFilename = path.basename(resolvedPath);
      } else if (args.file_base64) {
        fileBuffer = Buffer.from(args.file_base64, "base64");
        if (!targetFilename) targetFilename = `upload_${Date.now()}.png`;
      } else {
        throw new Error("Either file_path or file_base64 is required.");
      }

      const sanitizedName = targetFilename.replace(/[^a-zA-Z0-9._-]/g, "_");
      const storagePath = `posts/${Date.now()}_${sanitizedName}`;

      const ext = path.extname(sanitizedName).toLowerCase();
      const contentType =
        ext === ".png"
          ? "image/png"
          : ext === ".jpg" || ext === ".jpeg"
          ? "image/jpeg"
          : ext === ".webp"
          ? "image/webp"
          : ext === ".gif"
          ? "image/gif"
          : "application/octet-stream";

      const { data, error } = await adminClient.storage
        .from("media")
        .upload(storagePath, fileBuffer, {
          contentType,
          upsert: true,
        });

      if (error) throw new Error(`Supabase storage upload failed: ${error.message}`);

      return {
        ok: true,
        storage_path: data.path,
        content_type: contentType,
        size_bytes: fileBuffer.length,
      };
    }

    case "cadence_bulk_schedule_from_folder": {
      const folderPath = path.resolve(args.folder_path);
      if (!fs.existsSync(folderPath)) {
        throw new Error(`Folder path does not exist: ${folderPath}`);
      }

      const entries = fs.readdirSync(folderPath);
      const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
      const imageFiles = entries
        .filter((file) => imageExtensions.has(path.extname(file).toLowerCase()))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

      if (imageFiles.length === 0) {
        throw new Error(`No image files found in folder: ${folderPath}`);
      }

      // Read optional captions.json if available
      let captionsJson: Record<string, string> = {};
      const captionsJsonPath = path.join(folderPath, "captions.json");
      if (fs.existsSync(captionsJsonPath)) {
        try {
          captionsJson = JSON.parse(fs.readFileSync(captionsJsonPath, "utf-8"));
        } catch (e) {
          console.warn("Could not parse captions.json", e);
        }
      }

      // Calculate schedule times
      const intervalDays = Math.max(1, args.interval_days || 1);
      const postTime = args.post_time_ist || "10:00";
      const [postHour = "10", postMinute = "00"] = postTime.split(":");

      let startDateObj: Date;
      if (args.start_date) {
        startDateObj = new Date(parseDateTimeToIso(args.start_date));
      } else {
        // Tomorrow at specified time
        startDateObj = new Date();
        startDateObj.setDate(startDateObj.getDate() + 1);
      }

      const results = [];

      for (let i = 0; i < imageFiles.length; i++) {
        const imgFile = imageFiles[i];
        const imgPath = path.join(folderPath, imgFile);
        const baseName = path.parse(imgFile).name;

        // Determine caption:
        // 1. Check captions.json
        // 2. Check baseName.txt or baseName.md
        // 3. Fallback to image name
        let caption = captionsJson[imgFile] || captionsJson[baseName] || "";

        if (!caption) {
          const txtPath = path.join(folderPath, `${baseName}.txt`);
          const mdPath = path.join(folderPath, `${baseName}.md`);
          if (fs.existsSync(txtPath)) {
            caption = fs.readFileSync(txtPath, "utf-8").trim();
          } else if (fs.existsSync(mdPath)) {
            caption = fs.readFileSync(mdPath, "utf-8").trim();
          }
        }

        if (!caption) {
          caption = `Post #${i + 1} - ${baseName}`;
        }

        // Upload image
        const imgBuffer = fs.readFileSync(imgPath);
        const sanitized = imgFile.replace(/[^a-zA-Z0-9._-]/g, "_");
        const storagePath = `posts/${Date.now()}_${i}_${sanitized}`;
        const ext = path.extname(imgFile).toLowerCase();
        const contentType =
          ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";

        const uploadRes = await adminClient.storage
          .from("media")
          .upload(storagePath, imgBuffer, { contentType, upsert: true });

        if (uploadRes.error) {
          console.error(`Failed uploading ${imgFile}`, uploadRes.error.message);
          continue;
        }

        // Compute scheduled time in IST
        const curDate = new Date(startDateObj.getTime() + i * intervalDays * 24 * 60 * 60 * 1000);
        const yr = curDate.getFullYear();
        const mo = String(curDate.getMonth() + 1).padStart(2, "0");
        const dy = String(curDate.getDate()).padStart(2, "0");
        const istIso = `${yr}-${mo}-${dy}T${postHour.padStart(2, "0")}:${postMinute.padStart(2, "0")}:00+05:30`;
        const scheduledIso = new Date(istIso).toISOString();

        const hashtags = args.default_hashtags || "";

        const { data: post, error } = await adminClient
          .from("posts")
          .insert({
            caption,
            hashtags,
            media_type: "image",
            media_paths: [uploadRes.data.path],
            status: "scheduled",
            scheduled_at: scheduledIso,
          })
          .select()
          .single();

        if (error) {
          console.error(`Failed creating post for ${imgFile}`, error.message);
          continue;
        }

        await syncJobsForPost(post.id, args.destination_ids, scheduledIso, false);
        results.push({
          file: imgFile,
          post_id: post.id,
          scheduled_at_ist: `${yr}-${mo}-${dy} ${postHour}:${postMinute}`,
          scheduled_at_utc: scheduledIso,
        });
      }

      return {
        ok: true,
        folder: folderPath,
        scheduled_count: results.length,
        posts: results,
      };
    }

    case "cadence_update_post": {
      const updateData: Record<string, any> = {};
      if (args.caption !== undefined) updateData.caption = args.caption.trim();
      if (args.hashtags !== undefined) updateData.hashtags = args.hashtags.trim();
      if (args.media_paths !== undefined) {
        updateData.media_paths = args.media_paths;
        updateData.media_type =
          args.media_paths.length === 0 ? "none" : args.media_paths.length === 1 ? "image" : "images";
      }

      let scheduledIso = null;
      if (args.scheduled_at) {
        const { data: current, error: currentError } = await adminClient
          .from("posts")
          .select("status")
          .eq("id", args.post_id)
          .maybeSingle();

        if (currentError) throw new Error(currentError.message);
        if (!current) throw new Error(`Post not found with ID ${args.post_id}.`);
        if (current.status === "publishing" || current.status === "published") {
          throw new Error(
            `Post ${args.post_id} is ${current.status} and cannot be edited or rescheduled.`,
          );
        }

        scheduledIso = parseDateTimeToIso(args.scheduled_at);
        updateData.scheduled_at = scheduledIso;
        updateData.status = "scheduled";
        updateData.attempts = 0;
        updateData.next_attempt_at = null;
        updateData.last_error = null;
        updateData.locked_at = null;
        updateData.lock_token = null;
      }

      const { error } = await adminClient.from("posts").update(updateData).eq("id", args.post_id);
      if (error) throw new Error(error.message);

      if (args.destination_ids || scheduledIso) {
        await syncJobsForPost(args.post_id, args.destination_ids, scheduledIso, !scheduledIso);
      }

      return { ok: true, post_id: args.post_id, updated: Object.keys(updateData) };
    }

    case "cadence_delete_post": {
      const { data: current, error: currentError } = await adminClient
        .from("posts")
        .select("status, media_paths")
        .eq("id", args.post_id)
        .maybeSingle();

      if (currentError) throw new Error(currentError.message);
      if (!current) throw new Error(`Post not found with ID ${args.post_id}.`);
      if (current.status !== "draft" && current.status !== "cancelled") {
        throw new Error(
          `Only drafts and cancelled posts can be deleted. Post ${args.post_id} is ${current.status}.`,
        );
      }

      const { error } = await adminClient.from("posts").delete().eq("id", args.post_id);
      if (error) throw new Error(error.message);

      const mediaPaths = Array.isArray(current.media_paths)
        ? current.media_paths.filter((value): value is string => typeof value === "string")
        : [];
      if (mediaPaths.length > 0) {
        await adminClient.storage.from("media").remove(mediaPaths);
      }

      return { ok: true, post_id: args.post_id, message: "Post, publishing jobs and media deleted." };
    }

    case "cadence_retry_job": {
      const { data: job, error } = await adminClient
        .from("publishing_jobs")
        .select("id, post_id, status")
        .eq("id", args.job_id)
        .single();

      if (error || !job) throw new Error(`Job not found: ${args.job_id}`);

      if (job.status !== "failed" && job.status !== "manual_required") {
        throw new Error(
          `Only failed jobs or jobs that need attention can be retried. This job is ${job.status}.`,
        );
      }

      const { error: updateError } = await adminClient
        .from("publishing_jobs")
        .update({
          status: "scheduled",
          scheduled_at: new Date().toISOString(),
          next_attempt_at: new Date().toISOString(),
          attempts: 0,
          last_error: null,
          locked_at: null,
          lock_token: null,
        })
        .eq("id", args.job_id)
        .in("status", ["failed", "manual_required"]);

      if (updateError) throw new Error(updateError.message);

      await adminClient.rpc("admin_refresh_post_status", { p_post_id: job.post_id });
      return { ok: true, job_id: args.job_id, status: "scheduled", message: "Job reset to scheduled for immediate retry." };
    }

    case "cadence_trigger_publish": {
      // Delegate to the Edge Function worker. Claiming jobs here without
      // publishing them would leave them stuck in "publishing".
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

      if (!url || !key) {
        throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
      }

      const response = await fetch(`${url.replace(/\/+$/, "")}/functions/v1/publish-scheduled`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...(args.post_id ? { postId: args.post_id } : {}),
          ...(args.job_id ? { jobId: args.job_id } : {}),
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { error?: string; [key: string]: unknown }
        | null;

      if (!response.ok) {
        throw new Error(payload?.error || `Publishing worker returned HTTP ${response.status}.`);
      }

      return {
        ok: true,
        ...(payload ?? {}),
        message:
          typeof payload?.claimed === "number" && payload.claimed > 0
            ? `Worker processed ${payload.claimed} destination job(s).`
            : "No destination jobs were due for publishing.",
      };
    }

    case "cadence_get_logs": {
      let query = adminClient
        .from("publishing_logs")
        .select("id, post_id, event_type, message, metadata, created_at")
        .order("created_at", { ascending: false })
        .limit(Math.min(100, Math.max(1, args.limit || 20)));

      if (args.post_id) {
        query = query.eq("post_id", args.post_id);
      }

      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return { logs: data ?? [] };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

