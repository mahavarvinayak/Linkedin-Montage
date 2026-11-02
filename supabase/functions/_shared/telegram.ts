import type { AdminClient } from "./supabase.ts";

export function istDateTime(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return `${new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)} IST`;
}

export function previewText(value: string, max = 280): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/**
 * Sends a plain-text Telegram message. Plain text avoids Markdown escaping
 * bugs when captions contain underscores, asterisks or brackets.
 */
export async function sendTelegram(
  admin: AdminClient,
  text: string,
): Promise<{ ok: boolean; error?: string }> {
  if ((Deno.env.get("TELEGRAM_NOTIFICATIONS_ENABLED") ?? "true") === "false") {
    return { ok: false, error: "Telegram notifications are disabled by environment." };
  }

  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!botToken) return { ok: false, error: "TELEGRAM_BOT_TOKEN is not configured." };

  const { data: settings } = await admin
    .from("settings")
    .select("telegram_enabled, telegram_chat_id")
    .eq("id", 1)
    .maybeSingle();

  if (settings && settings.telegram_enabled === false) {
    return { ok: false, error: "Telegram notifications are disabled in Settings." };
  }

  const chatId = settings?.telegram_chat_id || Deno.env.get("TELEGRAM_CHAT_ID");
  if (!chatId) return { ok: false, error: "No Telegram chat ID is configured." };

  const body = text.length > 3900 ? `${text.slice(0, 3899)}…` : text;

  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: body,
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return { ok: false, error: `Telegram ${response.status}: ${detail.slice(0, 300)}` };
    }

    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Telegram request failed" };
  }
}
