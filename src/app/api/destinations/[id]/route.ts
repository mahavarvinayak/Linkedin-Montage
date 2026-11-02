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

  await logEvent(
    auth.supabase,
    null,
    "destination_updated",
    `${data.name} ${parsed.data.isEnabled ? "enabled" : "disabled"} for new posts.`,
    { destination_id: data.id },
  );

  return NextResponse.json({ destination: data });
}
