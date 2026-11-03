import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { apiError, logEvent } from "@/lib/api";
import { destinationToggleSchema, zodMessage } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  const parsed = destinationToggleSchema.safeParse(body);
  if (!parsed.success) return apiError(zodMessage(parsed.error));

  const { data, error } = await auth.supabase
    .from("linkedin_destinations")
    .update({ is_enabled: parsed.data.isEnabled })
    .eq("id", id)
    .select("id, name, is_enabled")
    .maybeSingle();

  if (error) return apiError(`Could not update the destination: ${error.message}`, 500);
  if (!data) return apiError("Destination not found.", 404);

  // Disabling a destination must also stop anything already queued for it,
  // otherwise the worker would still publish to a destination the admin just
  // switched off. Published jobs and drafts are left untouched.
  let cancelledJobs = 0;
  if (!parsed.data.isEnabled) {
    const { data: affected, error: cancelError } = await auth.supabase
      .from("publishing_jobs")
      .update({
        status: "cancelled",
        next_attempt_at: null,
        locked_at: null,
        lock_token: null,
        last_error: "Destination disabled in Cadence; this queued job was cancelled.",
      })
      .eq("destination_id", id)
      .eq("status", "scheduled")
      .select("post_id");

    if (cancelError) {
      return apiError(
        `Destination disabled, but queued jobs could not be cancelled: ${cancelError.message}`,
        500,
      );
    }

    cancelledJobs = affected?.length ?? 0;
    const postIds = [...new Set((affected ?? []).map((job) => job.post_id as string))];

    for (const postId of postIds) {
      const { error: refreshError } = await auth.supabase.rpc("admin_refresh_post_status", {
        p_post_id: postId,
      });
      if (refreshError) {
        await logEvent(auth.supabase, postId, "destination_update_warning", refreshError.message);
      }
    }
  }

  await logEvent(
    auth.supabase,
    null,
    "destination_updated",
    `${data.name} ${parsed.data.isEnabled ? "enabled" : "disabled"} for new posts.`,
    { destination_id: data.id, cancelled_jobs: cancelledJobs },
  );

  return NextResponse.json({ destination: data, cancelledJobs });
}
