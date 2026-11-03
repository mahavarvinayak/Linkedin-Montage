import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getLinkedInEnv } from "@/lib/env";
import { loadLinkedInAccess, LinkedInTokenError } from "@/lib/linkedin-tokens";
import type { DestinationRow, DestinationSyncResult, DestinationType } from "@/lib/types";

const API_BASE = "https://api.linkedin.com";
const PAGE_SIZE = 100;
const MAX_PAGES = 20;
const ORG_ACL_SCOPE = "r_organization_admin";
const ORG_PUBLISH_SCOPE = "w_organization_social";
const MEMBER_PUBLISH_SCOPE = "w_member_social";

export class DestinationSyncError extends Error {
  status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.name = "DestinationSyncError";
    this.status = status;
  }
}

function headers(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    "LinkedIn-Version": getLinkedInEnv().version,
    "X-Restli-Protocol-Version": "2.0.0",
  };
}

async function readError(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  let message = text.slice(0, 400);
  try {
    const parsed = JSON.parse(text) as { message?: string; error?: string };
    message = parsed.message ?? parsed.error ?? message;
  } catch {
    // Keep the raw text.
  }
  return message || `LinkedIn responded with HTTP ${response.status}.`;
}

function organizationIdFromUrn(urn: string): string | null {
  const match = /^urn:li:organization:(\d+)$/.exec(urn.trim());
  return match ? match[1] : null;
}

export function isSupportedAuthorUrn(value: string): boolean {
  return /^urn:li:(organization|person):\d+$/.test(value.trim());
}

type AclEntry = {
  organization?: string;
  role?: string;
  state?: string;
};

type OrganizationAclPage = {
  elements?: AclEntry[];
  paging?: { start?: number; count?: number; total?: number };
  metadata?: { start?: number; count?: number; total?: number };
};

type OrganizationDetails = {
  id?: number | string;
  localizedName?: string;
  name?: string;
  vanityName?: string;
  organizationType?: string;
  parentOrganization?: string;
};

async function listOrganizationAcls(accessToken: string): Promise<AclEntry[]> {
  const entries: AclEntry[] = [];
  let start = 0;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = new URL(`${API_BASE}/rest/organizationAcls`);
    url.searchParams.set("q", "roleAssignee");
    url.searchParams.set("role", "ADMINISTRATOR");
    url.searchParams.set("state", "APPROVED");
    url.searchParams.set("count", String(PAGE_SIZE));
    url.searchParams.set("start", String(start));

    let response: Response;
    try {
      response = await fetch(url, {
        headers: headers(accessToken),
        cache: "no-store",
        signal: AbortSignal.timeout(25_000),
      });
    } catch (error) {
      throw new DestinationSyncError(
        `Could not reach LinkedIn while listing organizations: ${
          error instanceof Error ? error.message : "network error"
        }`,
      );
    }

    if (response.status === 403) {
      throw new DestinationSyncError(
        "LinkedIn denied organization discovery (HTTP 403). The app needs the Community Management API with r_organization_admin, and the connected member must be an organization administrator.",
        403,
      );
    }

    if (!response.ok) {
      throw new DestinationSyncError(
        `LinkedIn organization discovery failed (HTTP ${response.status}). ${await readError(response)}`,
        response.status,
      );
    }

    const payload = (await response.json().catch(() => ({}))) as OrganizationAclPage;
    const elements = Array.isArray(payload.elements) ? payload.elements : [];
    entries.push(...elements);

    const paging = payload.paging ?? payload.metadata;
    const total = typeof paging?.total === "number" ? paging.total : null;
    const count = typeof paging?.count === "number" ? paging.count : elements.length;

    if (elements.length === 0 || count === 0) break;
    if (total !== null && entries.length >= total) break;
    if (elements.length < count) break;

    start += count;
  }

  return entries;
}

async function fetchOrganizationDetails(
  accessToken: string,
  organizationId: string,
): Promise<{ details: OrganizationDetails | null; error: string | null }> {
  try {
    const response = await fetch(`${API_BASE}/rest/organizations/${organizationId}`, {
      headers: headers(accessToken),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) {
      return { details: null, error: await readError(response) };
    }

    return { details: (await response.json().catch(() => null)) as OrganizationDetails | null, error: null };
  } catch (error) {
    return {
      details: null,
      error: error instanceof Error ? error.message : "Organization lookup failed.",
    };
  }
}

function organizationType(details: OrganizationDetails | null): DestinationType {
  if (!details) return "organization";

  const raw = (details.organizationType ?? "").toUpperCase();
  if (raw.includes("SHOWCASE")) return "showcase_page";
  if (details.parentOrganization) return "showcase_page";
  return "company_page";
}

function organizationName(details: OrganizationDetails | null, organizationId: string): string {
  const name = details?.localizedName ?? details?.name ?? details?.vanityName;
  return name?.trim() || `Organization ${organizationId}`;
}

async function log(
  admin: SupabaseClient,
  eventType: string,
  message: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await admin.from("publishing_logs").insert({
    post_id: null,
    event_type: eventType,
    message,
    metadata,
  });
  if (error) console.error("Could not write destination sync log", error.message);
}

function syncNotes(result: Omit<DestinationSyncResult, "ok" | "message">) {
  return {
    member_synced: result.memberSynced,
    organizations: result.organizations,
    discovered: result.discovered,
    unavailable: result.unavailable,
    permission_warning: result.permissionWarning,
  };
}

/**
 * Discovers every destination the connected member can publish to, subject to
 * the scopes LinkedIn actually granted:
 *
 *  - the member's personal profile (w_member_social)
 *  - organizations where the member is an APPROVED administrator, read through
 *    the paginated organizationAcls endpoint (r_organization_admin), including
 *    showcase pages that LinkedIn reports as organizations
 *
 * Nothing is invented: an organization whose publishing scope is missing is
 * stored as `permission_missing` with an explanation rather than being treated
 * as a working connection.
 */
export async function syncDestinations(
  admin: SupabaseClient,
  targetMemberUrn?: string | null,
): Promise<DestinationSyncResult> {
  let access;
  try {
    access = await loadLinkedInAccess(admin, targetMemberUrn);
  } catch (error) {
    if (error instanceof LinkedInTokenError) {
      throw new DestinationSyncError(error.message, error.code === "not_connected" ? 409 : 401);
    }
    throw error;
  }

  const scopes = new Set(access.scopes);
  const now = new Date().toISOString();
  const memberAuthorized = scopes.has(MEMBER_PUBLISH_SCOPE);

  const personal = {
    author_urn: access.memberUrn,
    account_urn: access.memberUrn,
    name: access.memberName?.trim() || "Personal profile",
    destination_type: "personal_profile" as DestinationType,
    publish_scope: MEMBER_PUBLISH_SCOPE,
    publish_authorized: memberAuthorized,
    status: memberAuthorized ? "available" : "permission_missing",
    status_detail: memberAuthorized
      ? null
      : "The granted token does not include w_member_social, so member publishing is not authorized. Reconnect and approve the posting permission.",
    source: "linkedin_sync" as const,
    is_enabled: true,
    last_seen_at: now,
    last_synced_at: now,
  };

  const seen = new Set<string>([access.memberUrn]);
  const rows: Record<string, unknown>[] = [personal];
  let permissionWarning: string | null = null;
  let organizationCount = 0;
  let unavailable = 0;

  const canDiscoverOrganizations = scopes.has(ORG_ACL_SCOPE) || scopes.has(ORG_PUBLISH_SCOPE);

  if (!canDiscoverOrganizations) {
    permissionWarning =
      `Organization discovery is paused: the connected token does not include ${ORG_ACL_SCOPE} or ${ORG_PUBLISH_SCOPE}. ` +
      "Company and Showcase Page publishing needs the Community Management API (and LinkedIn's approval for w_organization_social). " +
      "Personal profile publishing is unaffected.";
  } else {
    try {
      const acls = await listOrganizationAcls(access.accessToken);

      for (const acl of acls) {
        const organizationUrn = (acl.organization ?? "").trim();
        const organizationId = organizationIdFromUrn(organizationUrn);
        if (!organizationId) continue;
        if ((acl.state ?? "APPROVED").toUpperCase() !== "APPROVED") continue;

        seen.add(organizationUrn);
        organizationCount += 1;

        const { details, error } = await fetchOrganizationDetails(access.accessToken, organizationId);
        const authorized = scopes.has(ORG_PUBLISH_SCOPE);
        const type = organizationType(details);

        rows.push({
          author_urn: organizationUrn,
          organization_urn: organizationUrn,
          organization_id: organizationId,
          account_urn: access.memberUrn,
          name: organizationName(details, organizationId),
          destination_type: type,
          member_role: acl.role ?? "ADMINISTRATOR",
          publish_scope: ORG_PUBLISH_SCOPE,
          publish_authorized: authorized,
          status: authorized ? (error ? "error" : "available") : "permission_missing",
          status_detail: authorized
            ? error
              ? `LinkedIn returned this organization for the member, but its details could not be read: ${error}`
              : null
            : `The token is missing ${ORG_PUBLISH_SCOPE}, so organization publishing is not authorized. This needs approved Community Management API access; being an organization admin alone is not enough.`,
          source: "linkedin_sync" as const,
          is_enabled: true,
          last_seen_at: now,
          last_synced_at: now,
        });
      }
    } catch (error) {
      const message =
        error instanceof DestinationSyncError
          ? error.message
          : error instanceof Error
            ? error.message
            : "Organization discovery failed.";

      permissionWarning = message;
      // Do not mark existing organization destinations unavailable when the
      // discovery call itself failed: that would misreport a transient outage.
      // The personal profile is still valid and is saved below.
    }

    if (!permissionWarning) {
      const { data: existing, error: existingError } = await admin
        .from("linkedin_destinations")
        .select("id, author_urn")
        .eq("source", "linkedin_sync")
        .neq("destination_type", "personal_profile")
        .not("status", "eq", "unavailable");

      if (!existingError) {
        const stale = (existing ?? []).filter((row) => !seen.has(row.author_urn as string));
        if (stale.length > 0) {
          const { error: markError } = await admin
            .from("linkedin_destinations")
            .update({
              status: "unavailable",
              publish_authorized: false,
              status_detail:
                "LinkedIn no longer returns this destination for the connected account. It is kept for history but cannot publish.",
              last_synced_at: now,
            })
            .in("id", stale.map((row) => row.id as string));

          if (!markError) unavailable = stale.length;
        }
      }
    }
  }

  const { error: upsertError } = await admin
    .from("linkedin_destinations")
    .upsert(rows, { onConflict: "author_urn" });

  if (upsertError) {
    throw new DestinationSyncError(
      `Destinations could not be saved: ${upsertError.message}`,
      500,
    );
  }

  // If the token no longer carries organization publishing, every organization
  // destination must stop advertising itself as publishable, not just the ones
  // returned by this run.
  if (!scopes.has(ORG_PUBLISH_SCOPE)) {
    const { error: demoteError } = await admin
      .from("linkedin_destinations")
      .update({
        publish_authorized: false,
        status: "permission_missing",
        status_detail: `The token is missing ${ORG_PUBLISH_SCOPE}. Organization publishing requires approved Community Management API access; reconnect after the product is added to the LinkedIn app.`,
      })
      .neq("destination_type", "personal_profile")
      .neq("status", "unavailable");

    if (demoteError) {
      console.error("Could not demote organization destinations", demoteError.message);
    }
  }

  const result = {
    memberSynced: true,
    organizations: organizationCount,
    discovered: rows.length,
    unavailable,
    permissionWarning,
  };

  const { error: settingsError } = await admin
    .from("settings")
    .update({
      destinations_synced_at: now,
      destinations_last_error: permissionWarning,
      destinations_sync_notes: syncNotes(result),
    })
    .eq("id", 1);

  if (settingsError) {
    console.error("Could not record destination sync status", settingsError.message);
  }

  const message = permissionWarning
    ? `Synced ${rows.length} destination${rows.length === 1 ? "" : "s"}. ${permissionWarning}`
    : `Synced ${rows.length} destination${rows.length === 1 ? "" : "s"}${
        unavailable > 0 ? `, ${unavailable} marked unavailable` : ""
      }.`;

  await log(admin, permissionWarning ? "destination_sync_warning" : "destination_sync", message, {
    ...syncNotes(result),
  });

  return {
    ok: true,
    ...result,
    message,
  };
}

/**
 * Manual destination registration. LinkedIn still has to authorize publishing:
 * this only records the author URN after LinkedIn confirms the organization can
 * be read. It never grants access by itself.
 */
export async function registerManualDestination(
  admin: SupabaseClient,
  options: { authorUrn: string; name?: string },
): Promise<{ destination: DestinationRow; warning: string | null }> {
  const authorUrn = options.authorUrn.trim();
  if (!isSupportedAuthorUrn(authorUrn)) {
    throw new DestinationSyncError(
      "Enter a LinkedIn organization URN such as urn:li:organization:1234567.",
      400,
    );
  }

  const access = await loadLinkedInAccess(admin);
  const now = new Date().toISOString();
  const scopes = new Set(access.scopes);

  if (authorUrn.startsWith("urn:li:person:")) {
    const authorized = scopes.has(MEMBER_PUBLISH_SCOPE);
    return {
      destination: await upsertManualRow(admin, {
        author_urn: authorUrn,
        name: options.name?.trim() || "Personal profile",
        destination_type: "personal_profile",
        publish_scope: MEMBER_PUBLISH_SCOPE,
        publish_authorized: authorized,
        status: authorized ? "unverified" : "permission_missing",
        status_detail: authorized
          ? "Added manually. Cadence could not confirm this profile belongs to the connected member."
          : "The token is missing w_member_social, so publishing is not authorized.",
        source: "manual",
        last_synced_at: now,
      }),
      warning: "This author URN was added manually and has not been verified against the connected member.",
    };
  }

  const organizationId = organizationIdFromUrn(authorUrn);
  if (!organizationId) {
    throw new DestinationSyncError("That organization URN is not valid.", 400);
  }

  const { details, error } = await fetchOrganizationDetails(access.accessToken, organizationId);
  if (error) {
    throw new DestinationSyncError(
      `LinkedIn could not read that organization: ${error}. No destination was added.`,
      422,
    );
  }

  const authorized = scopes.has(ORG_PUBLISH_SCOPE);
  const destination = await upsertManualRow(admin, {
    author_urn: authorUrn,
    organization_urn: authorUrn,
    organization_id: organizationId,
    name: options.name?.trim() || organizationName(details, organizationId),
    destination_type: organizationType(details),
    member_role: null,
    publish_scope: ORG_PUBLISH_SCOPE,
    publish_authorized: authorized,
    status: authorized ? "unverified" : "permission_missing",
    status_detail: authorized
      ? "Added manually. LinkedIn confirmed the organization exists, but this member’s admin access and API publishing permission were not verified by the ACL sync."
      : `The token is missing ${ORG_PUBLISH_SCOPE}, so organization publishing is not authorized even though the organization was found.`,
    source: "manual",
    last_synced_at: now,
  });

  await log(admin, "destination_added_manually", `Added ${destination.name} manually.`, {
    author_urn: authorUrn,
    publish_authorized: authorized,
  });

  return {
    destination,
    warning: authorized
      ? "Added as unverified. Run Refresh destinations to let LinkedIn confirm your admin access before relying on it."
      : `Added, but the app is missing ${ORG_PUBLISH_SCOPE}. Publishing to this organization will fail until that scope is approved.`,
  };
}

async function upsertManualRow(
  admin: SupabaseClient,
  row: Record<string, unknown>,
): Promise<DestinationRow> {
  const { data, error } = await admin
    .from("linkedin_destinations")
    .upsert({ ...row, last_seen_at: new Date().toISOString() }, { onConflict: "author_urn" })
    .select("*")
    .single();

  if (error || !data) {
    throw new DestinationSyncError(
      `The destination could not be saved: ${error?.message ?? "unknown error"}`,
      500,
    );
  }

  return data as DestinationRow;
}
