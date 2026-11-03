import { adminClient, assertServiceRole, json, type AdminClient } from "../_shared/supabase.ts";
import {
  composeCommentary,
  createLinkedInPost,
  getPublishingIdentity,
  isRetryableError,
  LinkedInError,
  sanitizeError,
  uploadImageToLinkedIn,
} from "../_shared/linkedin.ts";
import { istDateTime, previewText, sendTelegram } from "../_shared/telegram.ts";

/**
 * A claimed publishing job, joined with its post content and destination by
 * public.admin_claim_due_jobs(). One job == one destination.
 */
type Job = {
  id: string;
  post_id: string;
  destination_id: string;
  author_urn: string;
  destination_name: string;
  destination_type: string;
  destination_account_urn?: string | null;
  job_status: string;
  attempts: number;
  max_attempts: number;
  lock_token: string | null;
  scheduled_at: string | null;
  post_caption: string;
  post_hashtags: string;
  post_media_type: string;
  post_media_paths: unknown;
  post_created_at: string;
  media_retention_hours: number;
};

type Outcome = "published" | "retried" | "failed" | "manual_required";

async function log(
  admin: AdminClient,
  job: Job,
  eventType: string,
  message: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await admin.from("publishing_logs").insert({
    post_id: job.post_id,
    event_type: eventType,
    message,
    metadata: {
      destination_id: job.destination_id,
      destination_name: job.destination_name,
      author_urn: job.author_urn,
      ...metadata,
    },
  });

  if (error) console.error("Could not write publishing log", error.message);
}

function mediaPaths(job: Job): string[] {
  if (!Array.isArray(job.post_media_paths)) return [];
  return job.post_media_paths.filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
}

function dashboardLink(path = "failed"): string {
  const base = Deno.env.get("APP_URL");
  return base ? `\nDashboard: ${base}/${path}` : "";
}

function destinationLabel(job: Job): string {
  const type = job.destination_type.replace(/_/g, " ");
  return `${job.destination_name} (${type})`;
}

async function refreshPost(admin: AdminClient, postId: string): Promise<void> {
  const { error } = await admin.rpc("admin_refresh_post_status", { p_post_id: postId });
  if (error) console.error("Could not refresh post status", postId, error.message);
}

async function notifyFailure(
  admin: AdminClient,
  job: Job,
  status: "failed" | "manual_required",
  message: string,
): Promise<void> {
  const caption = previewText(composeCommentary(job.post_caption, job.post_hashtags) || "(no caption)");
  const authProblem =
    /permission|authoriz|token|scope|not connected/i.test(message);
  const heading =
    status === "manual_required"
      ? authProblem
        ? "🔐 Destination needs authorization"
        : "⚠️ Destination needs manual attention"
      : "❌ Destination publishing failed";

  await sendTelegram(
    admin,
    [
      heading,
      "",
      `Destination: ${destinationLabel(job)}`,
      `Author: ${job.author_urn}`,
      `Caption: ${caption}`,
      `Scheduled: ${job.scheduled_at ? istDateTime(job.scheduled_at) : "not set"}`,
      `Attempts: ${job.attempts} of ${job.max_attempts}`,
      `Status: ${status}`,
      `Error: ${message}`,
      dashboardLink(),
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

async function notifySuccess(
  admin: AdminClient,
  job: Job,
  permalink: string,
): Promise<void> {
  const caption = previewText(composeCommentary(job.post_caption, job.post_hashtags) || "(no caption)");

  await sendTelegram(
    admin,
    [
      "✅ LinkedIn post published",
      "",
      `Destination: ${destinationLabel(job)}`,
      `Caption: ${caption}`,
      `Scheduled: ${job.scheduled_at ? istDateTime(job.scheduled_at) : "immediate"}`,
      `Post: ${permalink}`,
    ].join("\n"),
  );
}

async function markPublished(
  admin: AdminClient,
  job: Job,
  result: { postUrn: string; permalink: string },
): Promise<boolean> {
  const { data, error } = await admin
    .from("publishing_jobs")
    .update({
      status: "published",
      linkedin_post_id: result.postUrn,
      permalink: result.permalink,
      published_at: new Date().toISOString(),
      last_error: null,
      next_attempt_at: null,
      locked_at: null,
      lock_token: null,
    })
    .eq("id", job.id)
    .eq("lock_token", job.lock_token)
    .eq("status", "publishing")
    .select("id");

  if (error) {
    console.error("Could not mark destination as published", error.message);
    return false;
  }

  if (!data || data.length === 0) {
    console.error("Job claim was lost before it could be marked published", job.id);
    return false;
  }

  return true;
}

async function recordFailure(
  admin: AdminClient,
  job: Job,
  error: unknown,
): Promise<Outcome> {
  const message = sanitizeError(error).slice(0, 1500);
  const linkedInError = error instanceof LinkedInError ? error : null;
  const canRetry =
    isRetryableError(error) &&
    job.attempts < job.max_attempts &&
    linkedInError?.kind !== "token_expired" &&
    linkedInError?.kind !== "not_connected";

  if (canRetry) {
    const backoffMs =
      linkedInError?.retryAfterMs ??
      Math.min(60_000 * 2 ** Math.max(0, job.attempts - 1), 30 * 60_000);
    const nextAttemptAt = new Date(Date.now() + backoffMs).toISOString();

    await admin
      .from("publishing_jobs")
      .update({
        status: "scheduled",
        next_attempt_at: nextAttemptAt,
        last_error: message,
        locked_at: null,
        lock_token: null,
      })
      .eq("id", job.id)
      .eq("lock_token", job.lock_token);

    await log(
      admin,
      job,
      "publish_retry_scheduled",
      `Attempt ${job.attempts} failed for ${job.destination_name}. Retrying at ${nextAttemptAt}.`,
      { error: message, next_attempt_at: nextAttemptAt },
    );

    await refreshPost(admin, job.post_id);
    return "retried";
  }

  const uncertain = linkedInError?.uncertain === true;
  const needsHuman =
    uncertain ||
    linkedInError?.kind === "permission" ||
    linkedInError?.kind === "token_expired" ||
    linkedInError?.kind === "not_connected" ||
    linkedInError?.kind === "invalid" ||
    linkedInError?.kind === "media";

  const status: "failed" | "manual_required" = needsHuman ? "manual_required" : "failed";

  await admin
    .from("publishing_jobs")
    .update({
      status,
      last_error: message,
      next_attempt_at: null,
      locked_at: null,
      lock_token: null,
    })
    .eq("id", job.id)
    .eq("lock_token", job.lock_token);

  await log(
    admin,
    job,
    status === "manual_required" ? "manual_required" : "publish_failed",
    `${job.destination_name}: ${message}`,
    {
      attempts: job.attempts,
      uncertain,
      kind: linkedInError?.kind ?? "unknown",
    },
  );

  await refreshPost(admin, job.post_id);
  await notifyFailure(admin, job, status, message);
  return status;
}

async function publishJob(admin: AdminClient, job: Job, accessToken: string): Promise<Outcome> {
  await log(
    admin,
    job,
    "publish_started",
    `Attempt ${job.attempts} of ${job.max_attempts} for ${job.destination_name}.`,
  );

  if (job.post_media_type === "video") {
    return recordFailure(
      admin,
      job,
      new LinkedInError(
        "Video publishing is not enabled in this MVP. Edit the post to use text or images, or publish it manually.",
        { kind: "invalid" },
      ),
    );
  }

  const imageUrns: string[] = [];
  const paths = mediaPaths(job);

  try {
    for (const path of paths) {
      const urn = await uploadImageToLinkedIn(admin, accessToken, job.author_urn, path);
      imageUrns.push(urn);
    }
  } catch (error) {
    if (imageUrns.length > 0) {
      await log(
        admin,
        job,
        "media_upload_partial",
        `Uploaded ${imageUrns.length} of ${paths.length} images for ${job.destination_name} before a failure.`,
      );
    }
    return recordFailure(admin, job, error);
  }

  try {
    const result = await createLinkedInPost({
      accessToken,
      authorUrn: job.author_urn,
      commentary: composeCommentary(job.post_caption, job.post_hashtags),
      imageUrns,
    });

    const saved = await markPublished(admin, job, result);
    if (!saved) {
      return "manual_required";
    }

    await log(admin, job, "published", `Published as ${result.postUrn}.`, {
      linkedin_post_id: result.postUrn,
      permalink: result.permalink,
      images: imageUrns.length,
    });

    await refreshPost(admin, job.post_id);
    await notifySuccess(admin, job, result.permalink);
    return "published";
  } catch (error) {
    return recordFailure(admin, job, error);
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!assertServiceRole(req)) return json({ error: "Unauthorized" }, 401);

  const admin = adminClient();

  let requestedPostId: string | null = null;
  let requestedJobId: string | null = null;
  try {
    const body = (await req.json()) as { postId?: string; jobId?: string } | null;
    if (body?.postId && /^[0-9a-f-]{36}$/i.test(body.postId)) requestedPostId = body.postId;
    if (body?.jobId && /^[0-9a-f-]{36}$/i.test(body.jobId)) requestedJobId = body.jobId;
  } catch {
    // Empty body is the normal cron invocation.
  }

  const recovered = await admin.rpc("admin_recover_stale_jobs", { p_minutes: 10 });
  if (recovered.error) {
    console.error("Could not recover stale publishing jobs", recovered.error.message);
  }

  const settingsResult = await admin
    .from("settings")
    .select("linkedin_connected, linkedin_member_id, linkedin_last_error, linkedin_token_expires_at")
    .eq("id", 1)
    .maybeSingle();

  if (settingsResult.error) {
    return json({ error: `Could not read settings: ${settingsResult.error.message}` }, 500);
  }

  const settings = settingsResult.data;
  if (!settings?.linkedin_connected || !settings.linkedin_member_id) {
    return json({
      ok: true,
      skipped: "linkedin_not_connected",
      recovered: recovered.data ?? 0,
    });
  }

  let accessToken: string;
  try {
    const identity = await getPublishingIdentity(admin);
    accessToken = identity.accessToken;
  } catch (error) {
    const message = sanitizeError(error);
    const previous = settings.linkedin_last_error ?? "";

    if (message !== previous) {
      await admin
        .from("settings")
        .update({ linkedin_last_error: message })
        .eq("id", 1);

      if (!(error instanceof LinkedInError) || error.kind === "token_expired") {
        await sendTelegram(
          admin,
          [
            "🔑 LinkedIn session needs attention",
            "",
            message,
            "Scheduled destinations are paused until you reconnect from Settings.",
            dashboardLink("settings"),
          ]
            .filter(Boolean)
            .join("\n"),
        );
      }
    }

    return json({
      ok: true,
      skipped: "linkedin_not_ready",
      reason: message,
      recovered: recovered.data ?? 0,
    });
  }

  const limit = requestedJobId ? 1 : requestedPostId ? 25 : 5;

  const claim = await admin.rpc("admin_claim_due_jobs", {
    p_limit: limit,
    p_post_id: requestedJobId ? null : requestedPostId,
    p_job_id: requestedJobId,
  });

  if (claim.error) {
    return json({ error: `Could not claim publishing jobs: ${claim.error.message}` }, 500);
  }

  const jobs = (claim.data ?? []) as Job[];
  const summary = {
    ok: true,
    recovered: recovered.data ?? 0,
    claimed: jobs.length,
    published: 0,
    retried: 0,
    failed: 0,
    manual_required: 0,
  };

  for (const job of jobs) {
    try {
      let jobToken = accessToken;
      const targetUrn =
        job.destination_account_urn ||
        (job.destination_type === "personal_profile" ? job.author_urn : null);
      if (targetUrn) {
        try {
          const identity = await getPublishingIdentity(admin, targetUrn);
          jobToken = identity.accessToken;
        } catch {
          // fallback to default accessToken
        }
      }
      const outcome = await publishJob(admin, job, jobToken);
      summary[outcome] += 1;
    } catch (error) {
      // A crash here leaves the job in "publishing"; the next run's stale
      // recovery moves it to manual_required instead of blindly retrying.
      console.error("Unhandled publishing error", job.id, error);
      summary.failed += 1;
    }
  }

  return json(summary);
});
