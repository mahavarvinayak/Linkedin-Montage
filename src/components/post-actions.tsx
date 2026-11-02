"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  CalendarClock,
  CheckCircle2,
  Loader2,
  PenLine,
  RefreshCw,
  Send,
  Trash2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
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
import { istInputsToUtcIso, nowISTInputs, toISTInput, formatIST } from "@/lib/ist";
import type { PostView } from "@/lib/types";

type DialogKind = "reschedule" | "publish" | "cancel" | "delete" | "retry" | "manual" | null;

async function readError(response: Response, fallback: string): Promise<string> {
  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
  return payload?.error || fallback;
}

export function PostActions({
  post,
  context,
}: {
  post: PostView;
  context: "queue" | "failed";
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const initial = toISTInput(post.scheduled_at);
  const fallback = nowISTInputs(60);
  const [date, setDate] = useState(initial.date || fallback.date);
  const [time, setTime] = useState(initial.time || fallback.time);
  const [permalink, setPermalink] = useState("");
  const [verified, setVerified] = useState(false);

  const isManualRequired = post.status === "manual_required";

  function open(kind: DialogKind) {
    setError(null);
    setVerified(false);
    setPermalink(post.permalink ?? "");
    setDialog(kind);
  }

  function close() {
    if (busy) return;
    setDialog(null);
    setError(null);
  }

  async function patch(body: Record<string, unknown>, successMessage: string) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/posts/${post.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(await readError(response, "Could not update the post."));
      toast.success(successMessage);
      setDialog(null);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update the post.");
    } finally {
      setBusy(false);
    }
  }

  async function onReschedule(event: React.FormEvent) {
    event.preventDefault();
    const iso = istInputsToUtcIso(date, time);
    if (!iso) {
      setError("Choose a valid date and time.");
      return;
    }
    if (new Date(iso).getTime() < Date.now() - 60_000) {
      setError("The scheduled time must be in the future.");
      return;
    }
    await patch({ status: "scheduled", scheduledAt: iso }, "Post rescheduled.");
  }

  async function onPublishNow() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/posts/${post.id}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmUncertain: false }),
      });
      if (!response.ok) throw new Error(await readError(response, "Could not start publishing."));
      const payload = (await response.json()) as { warning?: string | null };
      if (payload.warning) {
        toast.message("Queued for publishing", { description: payload.warning });
      } else {
        toast.success("Publishing started.");
      }
      setDialog(null);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start publishing.");
    } finally {
      setBusy(false);
    }
  }

  async function onRetry() {
    if (isManualRequired && !verified) {
      setError("Confirm that you checked LinkedIn before retrying.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/posts/${post.id}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmUncertain: verified }),
      });
      if (!response.ok) throw new Error(await readError(response, "Could not retry the post."));
      const payload = (await response.json()) as { warning?: string | null };
      toast.message("Retry queued", {
        description: payload.warning ?? "The worker will attempt this post again.",
      });
      setDialog(null);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not retry the post.");
    } finally {
      setBusy(false);
    }
  }

  async function onManualPublished(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/posts/${post.id}/manual-published`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permalink: permalink.trim() || undefined }),
      });
      if (!response.ok) {
        throw new Error(await readError(response, "Could not mark the post as published."));
      }
      toast.success("Marked as published. Cadence will clean up the media later.");
      setDialog(null);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not mark the post as published.");
    } finally {
      setBusy(false);
    }
  }

  async function onCancel() {
    await patch({ status: "cancelled" }, "Post cancelled.");
  }

  async function onDelete() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/posts/${post.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await readError(response, "Could not delete the post."));
      toast.success("Draft deleted.");
      setDialog(null);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete the post.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        {context === "queue" ? (
          post.status === "cancelled" ? (
            <>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => patch({ status: "draft", scheduledAt: null }, "Post restored to drafts.")}
              >
                <RefreshCw />
                Restore draft
              </Button>
              <Button variant="ghost" size="sm" onClick={() => open("delete")}>
                <Trash2 />
                Delete
              </Button>
            </>
          ) : (
            <>
              <Link
                href={`/queue/${post.id}`}
                className={buttonVariants({ variant: "secondary", size: "sm" })}
              >
                <PenLine />
                Edit
              </Link>
              {post.status !== "publishing" ? (
                <>
                  <Button variant="ghost" size="sm" onClick={() => open("reschedule")}>
                    <CalendarClock />
                    Reschedule
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => open("publish")}>
                    <Send />
                    Publish now
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => open("cancel")}>
                    <XCircle />
                    Cancel
                  </Button>
                </>
              ) : null}
              {post.status === "draft" ? (
                <Button variant="ghost" size="sm" onClick={() => open("delete")}>
                  <Trash2 />
                  Delete
                </Button>
              ) : null}
            </>
          )
        ) : (
          <>
            <Link
              href={`/queue/${post.id}`}
              className={buttonVariants({ variant: "secondary", size: "sm" })}
            >
              <PenLine />
              Edit
            </Link>
            <Button variant="ghost" size="sm" onClick={() => open("retry")}>
              <RefreshCw />
              Retry
            </Button>
            <Button variant="ghost" size="sm" onClick={() => open("manual")}>
              <CheckCircle2 />
              Mark published
            </Button>
          </>
        )}
      </div>

      <Dialog open={dialog !== null} onOpenChange={(open) => (open ? null : close())}>
        <DialogContent>
          {dialog === "reschedule" ? (
            <form onSubmit={onReschedule} className="space-y-5">
              <DialogHeader>
                <DialogTitle>Reschedule post</DialogTitle>
                <DialogDescription>
                  Choose a new publishing time. The scheduler checks for due posts every minute.
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="reschedule-date">Date (IST)</Label>
                  <Input
                    id="reschedule-date"
                    type="date"
                    value={date}
                    onChange={(event) => setDate(event.target.value)}
                    disabled={busy}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reschedule-time">Time (IST)</Label>
                  <Input
                    id="reschedule-time"
                    type="time"
                    value={time}
                    onChange={(event) => setTime(event.target.value)}
                    disabled={busy}
                    required
                  />
                </div>
              </div>

              {post.status === "draft" ? (
                <p className="text-[11.5px] text-muted-foreground">
                  This draft will move to the scheduled queue.
                </p>
              ) : post.scheduled_at ? (
                <p className="text-[11.5px] text-muted-foreground">
                  Currently scheduled for {formatIST(post.scheduled_at)}.
                </p>
              ) : null}

              {error ? <Alert tone="danger" title="Could not reschedule">{error}</Alert> : null}

              <DialogFooter>
                <Button variant="secondary" onClick={close} disabled={busy}>
                  Cancel
                </Button>
                <Button type="submit" disabled={busy}>
                  {busy ? <Loader2 className="animate-spin" /> : <CalendarClock />}
                  Save schedule
                </Button>
              </DialogFooter>
            </form>
          ) : null}

          {dialog === "publish" ? (
            <div className="space-y-5">
              <DialogHeader>
                <DialogTitle>Publish now?</DialogTitle>
                <DialogDescription>
                  This sends the post to LinkedIn immediately. If it is currently scheduled, the
                  existing schedule is replaced.
                </DialogDescription>
              </DialogHeader>

              <div className="rounded-lg border border-border bg-stone-50 p-3 text-[12px] leading-relaxed text-stone-700">
                <p className="line-clamp-4 whitespace-pre-wrap">
                  {post.caption || "No caption."}
                </p>
                {post.hashtags ? (
                  <p className="mt-2 text-[11.5px] text-stone-500">{post.hashtags}</p>
                ) : null}
              </div>

              {error ? <Alert tone="danger" title="Could not publish">{error}</Alert> : null}

              <DialogFooter>
                <Button variant="secondary" onClick={close} disabled={busy}>
                  Keep as is
                </Button>
                <Button onClick={onPublishNow} disabled={busy}>
                  {busy ? <Loader2 className="animate-spin" /> : <Send />}
                  Publish now
                </Button>
              </DialogFooter>
            </div>
          ) : null}

          {dialog === "cancel" ? (
            <div className="space-y-5">
              <DialogHeader>
                <DialogTitle>Cancel this post?</DialogTitle>
                <DialogDescription>
                  It will stop being scheduled and move to the Cancelled tab, where you can restore
                  it to a draft or delete it.
                </DialogDescription>
              </DialogHeader>

              {error ? <Alert tone="danger" title="Could not cancel">{error}</Alert> : null}

              <DialogFooter>
                <Button variant="secondary" onClick={close} disabled={busy}>
                  Keep post
                </Button>
                <Button variant="destructive" onClick={onCancel} disabled={busy}>
                  {busy ? <Loader2 className="animate-spin" /> : <XCircle />}
                  Cancel post
                </Button>
              </DialogFooter>
            </div>
          ) : null}

          {dialog === "delete" ? (
            <div className="space-y-5">
              <DialogHeader>
                <DialogTitle>Delete this draft?</DialogTitle>
                <DialogDescription>
                  The draft and its images are removed permanently. This cannot be undone.
                </DialogDescription>
              </DialogHeader>

              {error ? <Alert tone="danger" title="Could not delete">{error}</Alert> : null}

              <DialogFooter>
                <Button variant="secondary" onClick={close} disabled={busy}>
                  Keep draft
                </Button>
                <Button variant="destructive" onClick={onDelete} disabled={busy}>
                  {busy ? <Loader2 className="animate-spin" /> : <Trash2 />}
                  Delete draft
                </Button>
              </DialogFooter>
            </div>
          ) : null}

          {dialog === "retry" ? (
            <div className="space-y-5">
              <DialogHeader>
                <DialogTitle>Retry publishing</DialogTitle>
                <DialogDescription>
                  The post is returned to the queue and the worker attempts it again.
                </DialogDescription>
              </DialogHeader>

              {post.last_error ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-[11.5px] leading-relaxed text-red-900">
                  <p className="font-medium">Last error</p>
                  <p className="mt-1 break-words">{post.last_error}</p>
                </div>
              ) : null}

              {isManualRequired ? (
                <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-3.5 text-[11.5px] leading-relaxed text-amber-950">
                  <p>
                    This post needs manual attention. Its outcome may be unknown, so Cadence did not
                    retry it automatically.
                  </p>
                  <label className="flex items-start gap-2 font-medium">
                    <input
                      type="checkbox"
                      className="mt-0.5 size-3.5 accent-amber-700"
                      checked={verified}
                      onChange={(event) => setVerified(event.target.checked)}
                    />
                    I checked LinkedIn and this post is not there.
                  </label>
                </div>
              ) : (
                <p className="text-[11.5px] text-muted-foreground">
                  If the previous failure was a token or permission error, fix that in Settings
                  first. Retrying will not help until the connection works.
                </p>
              )}

              {error ? <Alert tone="danger" title="Could not retry">{error}</Alert> : null}

              <DialogFooter>
                <Button variant="secondary" onClick={close} disabled={busy}>
                  Close
                </Button>
                <Button
                  onClick={onRetry}
                  disabled={busy || (isManualRequired && !verified)}
                >
                  {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                  Retry post
                </Button>
              </DialogFooter>
            </div>
          ) : null}

          {dialog === "manual" ? (
            <form onSubmit={onManualPublished} className="space-y-5">
              <DialogHeader>
                <DialogTitle>Mark as published manually</DialogTitle>
                <DialogDescription>
                  Use this only after you have published the post yourself, for example from
                  LinkedIn or a failed schedule. Cadence records it without calling the API.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-2">
                <Label htmlFor="permalink">LinkedIn post URL (optional)</Label>
                <Input
                  id="permalink"
                  value={permalink}
                  onChange={(event) => setPermalink(event.target.value)}
                  placeholder="https://www.linkedin.com/feed/update/…"
                  disabled={busy}
                />
                <p className="text-[11px] text-muted-foreground">
                  The URL is shown on the Published page. Leave it blank if you do not have it.
                </p>
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
