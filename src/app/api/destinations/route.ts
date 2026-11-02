import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { apiError, logEvent } from "@/lib/api";
import { createAdminClient } from "@/lib/supabase/admin";
import { DestinationSyncError, registerManualDestination } from "@/lib/linkedin-discovery";
import { manualDestinationSchema, zodMessage } from "@/lib/validation";
import { listDestinations } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  try {
    return NextResponse.json({ destinations: await listDestinations() });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Could not load destinations.", 500);
  }
}

/**
 * Manual destination registration. LinkedIn must still confirm that the
 * organization exists; publishing access is never granted by this endpoint.
 */
export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid JSON body.");
  }

  const parsed = manualDestinationSchema.safeParse(body);
  if (!parsed.success) return apiError(zodMessage(parsed.error));

  let admin;
  try {
    admin = createAdminClient();
  } catch (error) {
    return apiError(
      error instanceof Error ? error.message : "Supabase service role is not configured.",
      503,
    );
  }

  try {
    const result = await registerManualDestination(admin, parsed.data);
    await logEvent(
      admin,
      null,
      "destination_added_manually",
      `Added ${result.destination.name} (${result.destination.author_urn}).`,
      { source: "manual", publish_authorized: result.destination.publish_authorized },
    );
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof DestinationSyncError) {
      return apiError(error.message, error.status);
    }
    return apiError(
      error instanceof Error ? error.message : "Could not add the destination.",
      500,
    );
  }
}
