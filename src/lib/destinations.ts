import type {
  DestinationRow,
  DestinationStatus,
  DestinationType,
  JobStatus,
} from "@/lib/types";

export const DESTINATION_TYPE_LABELS: Record<DestinationType, string> = {
  personal_profile: "Personal profile",
  company_page: "Company page",
  showcase_page: "Showcase page",
  organization: "Organization",
  unknown: "LinkedIn destination",
};

export const DESTINATION_TYPE_SHORT: Record<DestinationType, string> = {
  personal_profile: "Profile",
  company_page: "Company",
  showcase_page: "Showcase",
  organization: "Organization",
  unknown: "Destination",
};

export const DESTINATION_STATUS_META: Record<
  DestinationStatus,
  { label: string; tone: "green" | "amber" | "red" | "neutral"; description: string }
> = {
  available: {
    label: "Ready",
    tone: "green",
    description: "LinkedIn confirmed this destination and the token can publish to it.",
  },
  unverified: {
    label: "Unverified",
    tone: "amber",
    description:
      "Added manually. LinkedIn has not confirmed this member’s publishing access, so the first publish may be rejected.",
  },
  permission_missing: {
    label: "Missing permission",
    tone: "amber",
    description:
      "The destination was discovered, but the granted token does not include the scope required to publish as it.",
  },
  unavailable: {
    label: "Unavailable",
    tone: "red",
    description:
      "LinkedIn no longer returns this destination for the connected account. It is kept for history but cannot publish.",
  },
  error: {
    label: "Needs attention",
    tone: "red",
    description: "The destination could not be read from LinkedIn during the last synchronization.",
  },
};

export const JOB_STATUS_META: Record<
  JobStatus,
  { label: string; tone: "green" | "amber" | "red" | "blue" | "neutral" | "gray" }
> = {
  pending: { label: "Not scheduled", tone: "neutral" },
  scheduled: { label: "Scheduled", tone: "blue" },
  publishing: { label: "Publishing", tone: "amber" },
  published: { label: "Published", tone: "green" },
  failed: { label: "Failed", tone: "red" },
  cancelled: { label: "Cancelled", tone: "gray" },
  manual_required: { label: "Needs attention", tone: "amber" },
};

export function destinationTypeLabel(type: DestinationType | null | undefined): string {
  return type ? (DESTINATION_TYPE_LABELS[type] ?? DESTINATION_TYPE_LABELS.unknown) : "LinkedIn destination";
}

export function destinationTypeShort(type: DestinationType | null | undefined): string {
  return type ? (DESTINATION_TYPE_SHORT[type] ?? DESTINATION_TYPE_SHORT.unknown) : "Destination";
}

/**
 * A destination can only be chosen for scheduling or publishing when it is
 * enabled and the stored token actually carries its publishing scope.
 */
export function isDestinationSelectable(
  destination: Pick<DestinationRow, "is_enabled" | "publish_authorized" | "status">,
): boolean {
  return (
    destination.is_enabled &&
    destination.publish_authorized &&
    (destination.status === "available" || destination.status === "unverified")
  );
}

export function destinationBlockedReason(
  destination: Pick<
    DestinationRow,
    "is_enabled" | "publish_authorized" | "status" | "status_detail" | "publish_scope"
  >,
): string | null {
  if (!destination.is_enabled) return "Disabled in Destinations.";
  if (destination.status === "unavailable") {
    return destination.status_detail || "LinkedIn no longer returns this destination.";
  }
  if (!destination.publish_authorized || destination.status === "permission_missing") {
    return (
      destination.status_detail ||
      `The token is missing ${destination.publish_scope}, so Cadence cannot publish as this destination.`
    );
  }
  if (destination.status === "error") {
    return destination.status_detail || "LinkedIn could not read this destination.";
  }
  return null;
}

export function openJobCount(jobs: { status: JobStatus }[]): number {
  return jobs.filter((job) => job.status === "scheduled" || job.status === "publishing").length;
}

export function publishedJobCount(jobs: { status: JobStatus }[]): number {
  return jobs.filter((job) => job.status === "published").length;
}

export function failedJobCount(jobs: { status: JobStatus }[]): number {
  return jobs.filter((job) => job.status === "failed" || job.status === "manual_required").length;
}

/** Shared chip tones so status colors stay consistent across the dashboard. */
export const TONE_CLASSES: Record<string, string> = {
  green: "border-emerald-200 bg-emerald-50 text-emerald-800",
  amber: "border-amber-200 bg-amber-50 text-amber-900",
  red: "border-red-200 bg-red-50 text-red-800",
  blue: "border-blue-200 bg-blue-50 text-blue-800",
  neutral: "border-stone-200 bg-white text-stone-600",
  gray: "border-stone-200 bg-stone-50 text-stone-500",
};

export const TONE_DOTS: Record<string, string> = {
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
  blue: "bg-blue-500",
  neutral: "bg-stone-300",
  gray: "bg-stone-300",
};
