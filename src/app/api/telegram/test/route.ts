import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { apiError, logEvent } from "@/lib/api";
import { getTelegramEnv } from "@/lib/env";
import { getSettingsRow } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const env = getTelegramEnv();
  if (!env.botToken) {
    return apiError("TELEGRAM_BOT_TOKEN is not configured on this deployment.", 503);
  }

  let chatId = env.chatId;
  try {
    const settings = await getSettingsRow();
    chatId = settings?.telegram_chat_id || chatId;
    if (settings && settings.telegram_enabled === false) {
      return apiError("Telegram notifications are turned off in Settings.", 409);
    }
  } catch (error) {
    return apiError(
      error instanceof Error ? error.message : "Could not read notification settings.",
      500,
    );
  }

  if (!chatId) {
    return apiError("Add a Telegram chat ID before sending a test message.", 409);
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${env.botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: "Cadence test message — your LinkedIn publishing alerts are connected.",
        disable_web_page_preview: true,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 300);
      const message = `Telegram returned HTTP ${response.status}. ${detail}`.trim();
      await logEvent(auth.supabase, null, "telegram_test_failed", message);
      return apiError(message, 502);
    }
  } catch (error) {
    const message =
      error instanceof Error && error.name === "TimeoutError"
        ? "Telegram did not respond in time."
        : "Could not reach Telegram.";
    return apiError(message, 502);
  }

  await logEvent(auth.supabase, null, "telegram_test_passed", "Telegram test message sent.");
  return NextResponse.json({ ok: true, chatId });
}
