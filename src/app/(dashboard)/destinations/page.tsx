import type { Metadata } from "next";
import Link from "next/link";
import { CircleAlert, Info } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { DestinationManager } from "@/components/destination-manager";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { getIntegrationStatus, listDestinations } from "@/lib/queries";
import { isDestinationSelectable } from "@/lib/destinations";
import type { DestinationRow } from "@/lib/types";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Destinations" };

export default async function DestinationsPage() {
  const status = await getIntegrationStatus();

  let destinations: DestinationRow[] = [];
  let loadError: string | null = null;
  try {
    destinations = await listDestinations();
  } catch (error) {
    loadError =
      error instanceof Error
        ? error.message
        : "Destinations could not be loaded. Has the 0003 migration been applied?";
  }

  const ready = destinations.filter((destination) => isDestinationSelectable(destination)).length;
  const disabled = destinations.filter((destination) => !destination.is_enabled).length;
  const needsAttention = destinations.filter(
    (destination) =>
      destination.status === "permission_missing" ||
      destination.status === "unavailable" ||
      destination.status === "error",
  ).length;
  const missingOrgScope = destinations.some(
    (destination) =>
      destination.destination_type !== "personal_profile" &&
      destination.status === "permission_missing",
  );

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Publishing"
        title="Destinations"
        description="Every LinkedIn author Cadence can publish as. Destinations are discovered from LinkedIn — never typed in by hand unless LinkedIn's API can confirm the organization."
      />

      {loadError ? (
        <Alert tone="danger" title="Destinations are unavailable">
          {loadError}
        </Alert>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Discovered" value={destinations.length} hint="Personal, Company and Showcase" />
        <StatCard label="Ready to publish" value={ready} hint="Enabled and authorized by scope" />
        <StatCard label="Needs attention" value={needsAttention} hint="Missing permission or unavailable" />
        <StatCard label="Disabled" value={disabled} hint="Hidden from the composer" />
      </div>

      <Card className="p-4 sm:p-5">
        <p className="flex items-center gap-2 text-[12.5px] font-medium">
          <Info className="size-3.5 text-stone-400" />
          How discovery and permissions work
        </p>
        <ul className="mt-2 space-y-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
          <li className="flex gap-2">
            <span className="text-stone-300">•</span>
            Personal profiles need <code className="font-mono text-[10.5px]">w_member_social</code>.
            Company and Showcase Pages need{" "}
            <code className="font-mono text-[10.5px]">w_organization_social</code> plus LinkedIn&apos;s
            approval for the Community Management API.
          </li>
          <li className="flex gap-2">
            <span className="text-stone-300">•</span>
            Organization discovery reads{" "}
            <code className="font-mono text-[10.5px]">organizationAcls</code> with{" "}
            <code className="font-mono text-[10.5px]">r_organization_admin</code>, so only pages where
            you are an approved administrator are returned.
          </li>
          <li className="flex gap-2">
            <span className="text-stone-300">•</span>
            Being an organization Super Admin does not by itself grant API publishing. Cadence shows
            the missing scope instead of pretending the destination is connected.
          </li>
          <li className="flex gap-2">
            <span className="text-stone-300">•</span>
            Destinations are never deleted. If LinkedIn stops returning one it is marked unavailable so
            past jobs keep their history.
          </li>
        </ul>
      </Card>

      {missingOrgScope ? (
        <Alert tone="warning" title="Organization publishing is not authorized yet">
          Some pages were discovered but the token does not include{" "}
          <code className="font-mono text-[11px]">w_organization_social</code>. Request the Community
          Management API product in the LinkedIn Developer Portal, add the scope to{" "}
          <code className="font-mono text-[11px]">LINKEDIN_SCOPES</code>, then reconnect LinkedIn from{" "}
          <Link href="/settings" className="underline underline-offset-4">
            Settings
          </Link>
          .
        </Alert>
      ) : null}

      {!status.environment.linkedin.configured ? (
        <Alert tone="warning" title="LinkedIn credentials are missing">
          Add <code className="font-mono text-[11px]">LINKEDIN_CLIENT_ID</code> and{" "}
          <code className="font-mono text-[11px]">LINKEDIN_CLIENT_SECRET</code> before connecting, then
          refresh destinations.
        </Alert>
      ) : null}

      {status.destinations.lastError ? (
        <Alert tone="warning" title="Last synchronization warning">
          {status.destinations.lastError}
        </Alert>
      ) : null}

      <DestinationManager
        destinations={destinations}
        connected={Boolean(status.settings?.linkedin_connected)}
        configured={status.environment.linkedin.configured}
        syncedAt={status.destinations.syncedAt}
        lastError={null}
      />

      {ready === 0 && destinations.length > 0 ? (
        <Alert tone="warning" title="No destination can publish yet">
          <span className="flex items-start gap-2">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
            Fix the permissions shown above, then refresh. Drafts can still be written in the
            meantime.
          </span>
        </Alert>
      ) : null}
    </div>
  );
}
