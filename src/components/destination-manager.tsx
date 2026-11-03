"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  CircleAlert,
  Copy,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  DESTINATION_STATUS_META,
  TONE_CLASSES,
  TONE_DOTS,
  destinationBlockedReason,
  destinationTypeLabel,
  isDestinationSelectable,
} from "@/lib/destinations";
import { formatIST, relativeTime } from "@/lib/ist";
import type { DestinationRow, DestinationSyncResult } from "@/lib/types";
import { cn } from "@/lib/utils";

type Filter = "all" | "ready" | "attention" | "disabled";

async function readError(response: Response, fallback: string): Promise<string> {
  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
  return payload?.error || fallback;
}

export function DestinationManager({
  destinations,
  connected,
  configured,
  syncedAt,
  lastError,
}: {
  destinations: DestinationRow[];
  connected: boolean;
  configured: boolean;
  syncedAt: string | null;
  lastError: string | null;
}) {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(lastError);
  const [info, setInfo] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [addOpen, setAddOpen] = useState(false);
  const [authorUrn, setAuthorUrn] = useState("");
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const counts = useMemo(
    () => ({
      all: destinations.length,
      ready: destinations.filter((destination) => isDestinationSelectable(destination)).length,
      attention: destinations.filter(
        (destination) =>
          destination.status === "permission_missing" ||
          destination.status === "unavailable" ||
          destination.status === "error",
      ).length,
      disabled: destinations.filter((destination) => !destination.is_enabled).length,
    }),
    [destinations],
  );

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return destinations.filter((destination) => {
      if (filter === "ready" && !isDestinationSelectable(destination)) return false;
      if (
        filter === "attention" &&
        destination.status !== "permission_missing" &&
        destination.status !== "unavailable" &&
        destination.status !== "error"
      ) {
        return false;
      }
      if (filter === "disabled" && destination.is_enabled) return false;
      if (!needle) return true;
      return [destination.name, destination.author_urn, destination.member_role ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [destinations, filter, query]);

  async function onSync() {
    setSyncing(true);
    setError(null);
    setInfo(null);
    try {
      const response = await fetch("/api/linkedin/destinations/sync", { method: "POST" });
      if (!response.ok) throw new Error(await readError(response, "Destination sync failed."));
      const payload = (await response.json()) as DestinationSyncResult;
      if (payload.permissionWarning) {
        setError(payload.permissionWarning);
        toast.message("Destinations synced with a warning", { description: payload.message });
      } else {
        setInfo(payload.message);
        toast.success("Destinations refreshed.");
      }
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Destination sync failed.");
    } finally {
      setSyncing(false);
    }
  }

  async function onAdd(event: React.FormEvent) {
    event.preventDefault();
    setAdding(true);
    setError(null);
    setInfo(null);
    try {
      const response = await fetch("/api/destinations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authorUrn: authorUrn.trim(), name: name.trim() || undefined }),
      });
      if (!response.ok) throw new Error(await readError(response, "Could not add the destination."));
      const payload = (await response.json()) as { warning?: string | null };
      toast.success("Destination added.");
      if (payload.warning) setInfo(payload.warning);
      setAddOpen(false);
      setAuthorUrn("");
      setName("");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not add the destination.");
    } finally {
      setAdding(false);
    }
  }

  async function onToggle(destination: DestinationRow, enabled: boolean) {
    setToggling(destination.id);
    setError(null);
    try {
      const response = await fetch(`/api/destinations/${destination.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isEnabled: enabled }),
      });
      if (!response.ok) throw new Error(await readError(response, "Could not update the destination."));
      const payload = (await response.json().catch(() => null)) as
        | { cancelledJobs?: number }
        | null;
      const cancelled = payload?.cancelledJobs ?? 0;
      if (!enabled && cancelled > 0) {
        toast.message("Destination disabled.", {
          description: `${cancelled} queued job${cancelled === 1 ? "" : "s"} for this destination were cancelled.`,
        });
      } else {
        toast.success(enabled ? "Destination enabled." : "Destination disabled.");
      }
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update the destination.");
    } finally {
      setToggling(null);
    }
  }

  async function copyUrn(urn: string) {
    try {
      await navigator.clipboard.writeText(urn);
      setCopied(urn);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      setError("Could not copy to the clipboard.");
    }
  }

  return (
    <div className="space-y-5">
      <Card className="p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[13px] font-medium">Destination discovery</p>
            <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
              Destinations come from LinkedIn, not from a hardcoded list. Refresh after connecting
              or when a page is added to your LinkedIn account.
            </p>
            <p className="mt-1.5 text-[10.5px] text-muted-foreground">
              {syncedAt
                ? `Last synchronized ${formatIST(syncedAt)} · ${relativeTime(syncedAt)}`
                : "Never synchronized on this workspace."}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={onSync}
              disabled={!connected || !configured || syncing}
              title={
                !configured
                  ? "Add LinkedIn client credentials first"
                  : !connected
                    ? "Connect LinkedIn first"
                    : undefined
              }
            >
              {syncing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              Refresh destinations
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setError(null);
                setInfo(null);
                setAddOpen(true);
              }}
              disabled={!connected || !configured}
            >
              <Plus />
              Add manually
            </Button>
          </div>
        </div>

        {!configured ? (
          <Alert tone="warning" title="LinkedIn credentials are missing" className="mt-4">
            Add <code className="font-mono text-[11px]">LINKEDIN_CLIENT_ID</code> and{" "}
            <code className="font-mono text-[11px]">LINKEDIN_CLIENT_SECRET</code>, then connect from
            Settings.
          </Alert>
        ) : !connected ? (
          <Alert tone="warning" title="LinkedIn is not connected" className="mt-4">
            Connect LinkedIn in Settings before refreshing destinations.
          </Alert>
        ) : null}

        {error ? (
          <Alert tone="warning" title="Destination access" className="mt-4">
            {error}
          </Alert>
        ) : null}
        {info ? (
          <Alert tone="success" title="Destinations" className="mt-4">
            {info}
          </Alert>
        ) : null}
      </Card>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-1 rounded-lg border border-border bg-card p-1">
          {(
            [
              { key: "all", label: "All" },
              { key: "ready", label: "Ready" },
              { key: "attention", label: "Needs attention" },
              { key: "disabled", label: "Disabled" },
            ] as const
          ).map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setFilter(item.key)}
              className={cn(
                "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-[12px] transition-colors",
                filter === item.key
                  ? "bg-stone-100 font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {item.label}
              <span
                className={cn(
                  "nums rounded-full px-1.5 text-[10px]",
                  filter === item.key ? "bg-white text-stone-600" : "bg-stone-50 text-stone-400",
                )}
              >
                {counts[item.key]}
              </span>
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-stone-400" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search destinations"
            className="h-9 pl-8 text-[12px]"
            aria-label="Search destinations"
          />
        </div>
      </div>

      {destinations.length === 0 ? (
        <div className="rounded-xl border border-dashed border-stone-300 bg-white/60 px-5 py-12 text-center">
          <ShieldAlert className="mx-auto size-5 text-stone-400" />
          <p className="mt-2 text-[13px] font-medium">No destinations discovered yet</p>
          <p className="mx-auto mt-1 max-w-md text-[11.5px] leading-relaxed text-muted-foreground">
            Connect LinkedIn and run Refresh destinations. Cadence asks LinkedIn for the member
            profile and every organization the member administers. Nothing is assumed or hardcoded.
          </p>
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-stone-300 bg-white/60 px-5 py-10 text-center text-[12px] text-muted-foreground">
          No destinations in this view.
        </div>
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {visible.map((destination) => {
            const meta = DESTINATION_STATUS_META[destination.status];
            const blockedReason = destinationBlockedReason(destination);

            return (
              <article key={destination.id} className="px-4 py-4 sm:px-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[13px] font-medium">{destination.name}</p>
                      <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[9.5px] uppercase tracking-[0.08em] text-stone-500">
                        {destinationTypeLabel(destination.destination_type)}
                      </span>
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px]",
                          TONE_CLASSES[meta.tone] ?? TONE_CLASSES.neutral,
                        )}
                      >
                        <span
                          className={cn(
                            "size-1.5 rounded-full",
                            TONE_DOTS[meta.tone] ?? TONE_DOTS.neutral,
                          )}
                        />
                        {meta.label}
                      </span>
                      {destination.source === "manual" ? (
                        <span className="rounded-full border border-stone-200 bg-stone-50 px-2 py-0.5 text-[9.5px] text-stone-500">
                          Manual
                        </span>
                      ) : null}
                      {!destination.is_enabled ? (
                        <span className="rounded-full border border-stone-200 bg-white px-2 py-0.5 text-[9.5px] text-stone-500">
                          Disabled
                        </span>
                      ) : null}
                    </div>

                    <button
                      type="button"
                      onClick={() => copyUrn(destination.author_urn)}
                      className="mt-1.5 inline-flex max-w-full items-center gap-1.5 rounded font-mono text-[10.5px] text-muted-foreground hover:text-foreground"
                      title="Copy author URN"
                    >
                      <span className="truncate">{destination.author_urn}</span>
                      {copied === destination.author_urn ? (
                        <CheckCircle2 className="size-3 shrink-0 text-emerald-600" />
                      ) : (
                        <Copy className="size-3 shrink-0" />
                      )}
                    </button>

                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10.5px] text-muted-foreground">
                      <span>
                        Requires{" "}
                        <code className="font-mono text-[10px]">{destination.publish_scope}</code>
                      </span>
                      {destination.member_role ? <span>Role: {destination.member_role}</span> : null}
                      <span>
                        {destination.last_synced_at
                          ? `Synced ${relativeTime(destination.last_synced_at)}`
                          : "Not synced"}
                      </span>
                    </div>

                    {blockedReason ? (
                      <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-amber-800">
                        <CircleAlert className="mt-0.5 size-3 shrink-0" />
                        {blockedReason}
                      </p>
                    ) : meta.description ? (
                      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                        {meta.description}
                      </p>
                    ) : null}
                  </div>

                  <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span>{destination.is_enabled ? "Enabled" : "Disabled"}</span>
                    <Switch
                      checked={destination.is_enabled}
                      onCheckedChange={(checked) => onToggle(destination, checked)}
                      disabled={toggling === destination.id}
                      aria-label={`Enable ${destination.name}`}
                    />
                  </label>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <Dialog open={addOpen} onOpenChange={(open) => (open ? null : setAddOpen(false))}>
        <DialogContent>
          <form onSubmit={onAdd} className="space-y-5">
            <DialogHeader>
              <DialogTitle>Add a destination manually</DialogTitle>
              <DialogDescription>
                Use this only when LinkedIn can read an organization that the administrator sync did
                not return. LinkedIn still enforces posting permissions; this does not grant access.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2">
              <Label htmlFor="destination-urn">Organization URN</Label>
              <Input
                id="destination-urn"
                value={authorUrn}
                onChange={(event) => setAuthorUrn(event.target.value)}
                placeholder="urn:li:organization:1234567"
                disabled={adding}
                required
              />
              <p className="text-[10.5px] text-muted-foreground">
                Cadence verifies the organization with LinkedIn before saving it. The destination is
                marked unverified until a sync confirms your admin access.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="destination-name">Display name (optional)</Label>
              <Input
                id="destination-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Defaults to the LinkedIn organization name"
                disabled={adding}
              />
            </div>

            {error ? <Alert tone="danger" title="Could not add">{error}</Alert> : null}

            <DialogFooter>
              <Button
                variant="secondary"
                type="button"
                onClick={() => setAddOpen(false)}
                disabled={adding}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={adding}>
                {adding ? <Loader2 className="animate-spin" /> : <Plus />}
                Verify and add
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
