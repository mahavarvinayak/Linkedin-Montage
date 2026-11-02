export const TIMEZONE = "Asia/Kolkata";

const dateTimeFormatter = new Intl.DateTimeFormat("en-IN", {
  timeZone: TIMEZONE,
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
});

const dateFormatter = new Intl.DateTimeFormat("en-IN", {
  timeZone: TIMEZONE,
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
});

const timeFormatter = new Intl.DateTimeFormat("en-IN", {
  timeZone: TIMEZONE,
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

const shortDateFormatter = new Intl.DateTimeFormat("en-IN", {
  timeZone: TIMEZONE,
  day: "numeric",
  month: "short",
});

export function formatIST(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return `${dateFormatter.format(date)} · ${timeFormatter.format(date)} IST`;
}

export function formatISTDate(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return dateTimeFormatter.format(date);
}

export function formatISTShort(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return shortDateFormatter.format(date);
}

export function formatISTTime(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return `${timeFormatter.format(date)} IST`;
}

function partsInIST(date: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
  };
}

/** Converts an ISO timestamp into values suitable for date and time inputs. */
export function toISTInput(value: string | Date | null | undefined): {
  date: string;
  time: string;
} {
  if (!value) return { date: "", time: "" };
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return { date: "", time: "" };

  const parts = partsInIST(date);
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

/**
 * IST is UTC+05:30 all year (India does not observe DST), so a fixed offset is
 * exact and avoids surprising server/browser timezone conversions.
 */
export function istInputsToUtcIso(date: string, time: string): string | null {
  if (!date || !time) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;

  const parsed = new Date(`${date}T${time}:00+05:30`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function nowISTInputs(offsetMinutes = 60): { date: string; time: string } {
  return toISTInput(new Date(Date.now() + offsetMinutes * 60 * 1000));
}

export function startOfMonthISTIso(now = new Date()): string {
  const parts = partsInIST(now);
  return new Date(`${parts.year}-${parts.month}-01T00:00:00+05:30`).toISOString();
}

export function relativeTime(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";

  const diffMs = date.getTime() - Date.now();
  const abs = Math.abs(diffMs);
  const future = diffMs > 0;

  const minutes = Math.round(abs / 60_000);
  if (minutes < 1) return "just now";

  let amount: string;
  if (minutes < 60) amount = `${minutes}m`;
  else if (minutes < 60 * 24) amount = `${Math.round(minutes / 60)}h`;
  else amount = `${Math.round(minutes / (60 * 24))}d`;

  return future ? `in ${amount}` : `${amount} ago`;
}

export function isPast(value: string | null | undefined): boolean {
  if (!value) return false;
  return new Date(value).getTime() < Date.now();
}
