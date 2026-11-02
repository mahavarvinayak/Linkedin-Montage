import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { apiError, logEvent } from "@/lib/api";
import { settingsSchema, zodMessage } from "@/lib/validation";

export const runtime = "nodejs";

export async function PATCH(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid JSON body.");
  }

  const parsed = settingsSchema.safeParse(body);
  if (!parsed.success) return apiError(zodMessage(parsed.error));

  const updates: Record<string, unknown> = {};

  if (parsed.data.telegramEnabled !== undefined) {
    updates.telegram_enabled = parsed.data.telegramEnabled;
  }

  if (parsed.data.telegramChatId !== undefined) {
    updates.telegram_chat_id = parsed.data.telegramChatId || null;
  }

  if (parsed.data.mediaRetentionHours !== undefined) {
    updates.media_retention_hours = parsed.data.mediaRetentionHours;
  }

  if (Object.keys(updates).length === 0) {
    return apiError("Nothing to update.");
  }

  const { data, error } = await auth.supabase
    .from("settings")
    .update(updates)
    .eq("id", 1)
    .select(
      "telegram_enabled, telegram_chat_id, media_retention_hours, linkedin_connected, linkedin_member_id, linkedin_token_expires_at",
    )
    .single();

  if (error) return apiError(`Could not save settings: ${error.message}`, 500);

  await logEvent(auth.supabase, null, "settings_updated", "Notification settings updated.", {
    fields: Object.keys(updates),
  });

  return NextResponse.json({ settings: data });
}
