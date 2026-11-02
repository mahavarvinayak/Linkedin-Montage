import type { PostStatus } from "./types";

export const MEDIA_BUCKET = "media";

export const MAX_IMAGES = 9;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_CAPTION_LENGTH = 3000;
export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif"] as const;
export const ALLOWED_IMAGE_LABEL = "JPG, PNG or GIF up to 8 MB each";

export const TIMEZONE_LABEL = "Asia/Kolkata (IST)";

export const STATUS_META: Record<
  PostStatus,
  { label: string; tone: "neutral" | "blue" | "green" | "red" | "amber" | "gray" }
> = {
  draft: { label: "Draft", tone: "neutral" },
  scheduled: { label: "Scheduled", tone: "blue" },
  publishing: { label: "Publishing", tone: "amber" },
  published: { label: "Published", tone: "green" },
  failed: { label: "Failed", tone: "red" },
  cancelled: { label: "Cancelled", tone: "gray" },
  manual_required: { label: "Needs attention", tone: "amber" },
};

export const ACTIVE_QUEUE_STATUSES: PostStatus[] = ["draft", "scheduled", "publishing"];

export const NAV_ITEMS = [
  { key: "overview", href: "/overview", label: "Overview" },
  { key: "create", href: "/create", label: "Create Post" },
  { key: "queue", href: "/queue", label: "Content Queue" },
  { key: "published", href: "/published", label: "Published Posts" },
  { key: "failed", href: "/failed", label: "Failed Posts" },
  { key: "destinations", href: "/destinations", label: "Destinations" },
  { key: "settings", href: "/settings", label: "Settings" },
] as const;

export type NavKey = (typeof NAV_ITEMS)[number]["key"];
