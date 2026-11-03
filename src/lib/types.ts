export const POST_STATUSES = [
  "draft",
  "scheduled",
  "publishing",
  "published",
  "failed",
  "cancelled",
  "manual_required",
] as const;

export type PostStatus = (typeof POST_STATUSES)[number];

export const JOB_STATUSES = [
  "pending",
  "scheduled",
  "publishing",
  "published",
  "failed",
  "cancelled",
  "manual_required",
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export const DESTINATION_TYPES = [
  "personal_profile",
  "company_page",
  "showcase_page",
  "organization",
  "unknown",
] as const;

export type DestinationType = (typeof DESTINATION_TYPES)[number];

export const DESTINATION_STATUSES = [
  "available",
  "unavailable",
  "permission_missing",
  "unverified",
  "error",
] as const;

export type DestinationStatus = (typeof DESTINATION_STATUSES)[number];

export type MediaType = "none" | "image" | "images" | "video";

export interface PostRow {
  id: string;
  caption: string;
  hashtags: string;
  media_type: MediaType;
  media_paths: string[];
  scheduled_at: string | null;
  status: PostStatus;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string | null;
  last_attempt_at: string | null;
  linkedin_post_id: string | null;
  permalink: string | null;
  last_error: string | null;
  published_at: string | null;
  media_delete_after: string | null;
  media_deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MediaItem {
  path: string;
  url: string | null;
}

export interface DestinationRow {
  id: string;
  author_urn: string;
  organization_urn: string | null;
  organization_id: string | null;
  account_urn?: string | null;
  name: string;
  destination_type: DestinationType;
  member_role: string | null;
  publish_scope: string;
  publish_authorized: boolean;
  status: DestinationStatus;
  status_detail: string | null;
  source: "linkedin_sync" | "manual";
  is_enabled: boolean;
  last_seen_at: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface LinkedInAccountRow {
  id: string;
  member_urn: string;
  name: string;
  picture: string | null;
  email: string | null;
  token_expires_at: string | null;
  scopes: string[];
  status: "connected" | "expired" | "error" | "disconnected";
  last_error: string | null;
  connected_at: string;
  updated_at: string;
}

export interface PublishingJobRow {
  id: string;
  post_id: string;
  destination_id: string;
  author_urn: string;
  status: JobStatus;
  scheduled_at: string | null;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string | null;
  last_attempt_at: string | null;
  published_at: string | null;
  linkedin_post_id: string | null;
  permalink: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export type DestinationSummary = Pick<
  DestinationRow,
  | "id"
  | "name"
  | "destination_type"
  | "status"
  | "publish_authorized"
  | "is_enabled"
  | "author_urn"
>;

export type PostJobView = PublishingJobRow & {
  destination: DestinationSummary | null;
};

export type PostView = PostRow & { media: MediaItem[]; jobs: PostJobView[] };

export interface PublishingLogRow {
  id: string;
  post_id: string | null;
  event_type: string;
  message: string;
  metadata: Record<string, unknown>;
  created_at: string;
  post?: { id: string; caption: string } | null;
}

export interface SettingsRow {
  id: number;
  linkedin_member_id: string | null;
  linkedin_member_name: string | null;
  linkedin_member_picture: string | null;
  linkedin_connected: boolean;
  linkedin_connected_at: string | null;
  linkedin_token_expires_at: string | null;
  linkedin_scopes: string[];
  linkedin_last_error: string | null;
  destinations_synced_at: string | null;
  destinations_last_error: string | null;
  destinations_sync_notes: Record<string, unknown>;
  telegram_enabled: boolean;
  telegram_chat_id: string | null;
  media_retention_hours: number;
  created_at: string;
  updated_at: string;
}

export interface DestinationSyncResult {
  ok: boolean;
  memberSynced: boolean;
  organizations: number;
  discovered: number;
  unavailable: number;
  permissionWarning: string | null;
  message: string;
}
