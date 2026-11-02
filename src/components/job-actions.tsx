"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
import type { PostJobView } from "@/lib/types";

async function readError(response: Response, fallback: string): Promise<string> {
  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
  return payload?.error || fallback;
}

/**
 * Recovery actions for a single destination job. Retrying one destination never
 * touches the destinations that already published.
 */
export function JobActions({ postId, job }: { postId: string; job: PostJobView }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<"retry" | "manual" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verified, setVerified] = useState(false);
  const [permalink, setPermalink] = useState(job.permalink ?? "");

  const destinationName = job.destination?.name ?? job.author_urn;
  const isManualRequired = job.status === "manual_required";

  function open(kind: "retry" | "manual") {
    setError(null);
    setVerified(false);
    setPermalink(job.permalink ?? "");
    setDialog(kind);
  }

  function close() {
    if (busy) return;
    setDialog(null);
    setError(null);
  }

  async function onRetry() {
    if (isManualRequired && !verified) {
      setError("Confirm that you checked LinkedIn before retrying this destination.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/posts/${postId}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          destinationId: job.destination_id,
          confirmUncertain: verified,
        }),
      });
      if (!response.ok) throw new Error(await readError(response, "Could not retry this destination."));
      const payload = (await response.json()) as { warning?: string | null };
      toast.message(`Retry queued for ${destinationName}`, {
        description: payload.warning ?? "The worker will attempt this destination again.",
      });
      setDialog(null);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not retry this destination.");
    } finally {
      setBusy(false);
    }
  }

  async function onManualPublished(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/posts/${postId}/manual-published`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          destinationId: job.destination_id,
          permalink: permalink.trim() || undefined,
        }),
      });
      if (!response.ok) {
        throw new Error(await readError(response, "Could not mark this destination as published."));
      }
      toast.success(`${destinationName} marked as published.`);
      setDialog(null);
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not mark this destination as published.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button variant="secondary" size="sm" onClick={() => open("retry")}>
          <RefreshCw />
          Retry
        </Button>
        <Button variant="ghost" size="sm" onClick={() => open("manual")}>
          <CheckCircle2 />
          Mark published
        </Button>
      </div>

      <Dialog open={dialog !== null} onOpenChange={(open) => (open ? null : close())}>
        <DialogContent>
          {dialog === "retry" ? (
            <div className="space-y-5">
              <DialogHeader>
                <DialogTitle>Retry {destinationName}</DialogTitle>
                <DialogDescription>
                  Only this destination is queued again. Destinations that already published are not
                  touched.
                </DialogDescription>
              </DialogHeader>

              {job.last_error ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-[11.5px] leading-relaxed text-red-900">
                  <p className="font-medium">Last error</p>
                  <p className="mt-1 break-words">{job.last_error}</p>
                </div>
              ) : null}

              {isManualRequired ? (
                <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-3.5 text-[11.5px] leading-relaxed text-amber-950">
                  <p>
                    This destination needs manual attention. Its outcome may be unknown, so Cadence
                    did not retry it automatically.
                  </p>
                  <label className="flex items-start gap-2 font-medium">
                    <input
                      type="checkbox"
                      className="mt-0.5 size-3.5 accent-amber-700"
                      checked={verified}
                      onChange={(event) => setVerified(event.target.checked)}
                    />
                    I checked {destinationName} on LinkedIn and this post is not there.
                  </label>
                </div>
              ) : null}

              {error ? <Alert tone="danger" title="Could not retry">{error}</Alert> : null}

              <DialogFooter>
                <Button variant="secondary" onClick={close} disabled={busy}>
                  Close
                </Button>
                <Button onClick={onRetry} disabled={busy || (isManualRequired && !verified)}>
                  {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                  Retry destination
                </Button>
              </DialogFooter>
            </div>
          ) : null}

          {dialog === "manual" ? (
            <form onSubmit={onManualPublished} className="space-y-5">
              <DialogHeader>
                <DialogTitle>Mark {destinationName} as published</DialogTitle>
                <DialogDescription>
                  Use this only after you published this destination yourself on LinkedIn. No API
                  call is made and the other destinations are unaffected.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-2">
                <Label htmlFor={`permalink-${job.id}`}>LinkedIn post URL (optional)</Label>
                <Input
                  id={`permalink-${job.id}`}
                  value={permalink}
                  onChange={(event) => setPermalink(event.target.value)}
                  placeholder="https://www.linkedin.com/feed/update/…"
                  disabled={busy}
                />
              </div>

              {error ? <Alert tone="danger" title="Could not save">{error}</Alert> : null}

              <DialogFooter>
                <Button variant="secondary" onClick={close} disabled={busy}>
                  Close
                </Button>
                <Button type="submit" disabled={busy}>
                  {busy ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
                  Mark published
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
