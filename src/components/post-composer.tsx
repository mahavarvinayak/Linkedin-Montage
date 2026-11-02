"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  ImagePlus,
  Loader2,
  Send,
  Share2,
  Sparkles,
  UploadCloud,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/textarea";
import { DestinationSelector } from "@/components/destination-selector";
import { LinkedInPreview } from "@/components/linkedin-preview";
import { composePreviewText, composedLength } from "@/lib/preview";
import {
  ALLOWED_IMAGE_LABEL,
  ALLOWED_IMAGE_TYPES,
  MAX_CAPTION_LENGTH,
  MAX_IMAGES,
  MAX_IMAGE_BYTES,
} from "@/lib/constants";
import { istInputsToUtcIso, nowISTInputs, toISTInput } from "@/lib/ist";
import { destinationTypeLabel, isDestinationSelectable } from "@/lib/destinations";
import type { DestinationRow, PostView } from "@/lib/types";
import { cn } from "@/lib/utils";

type MediaItem = {
  key: string;
  path: string | null;
  previewUrl: string | null;
  file: File | null;
  name: string;
  removedExisting: boolean;
};

type SaveMode = "draft" | "scheduled" | "publish";
type BusyState = SaveMode | null;

function newKey() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function makeMediaItem(file: File): MediaItem {
  return {
    key: newKey(),
    path: null,
    previewUrl: URL.createObjectURL(file),
    file,
    name: file.name,
    removedExisting: false,
  };
}

async function readError(response: Response, fallback: string): Promise<string> {
  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
  return payload?.error || fallback;
}

export function PostComposer({
  mode,
  post,
  authorName,
  authorPicture,
  linkedinReady,
  destinations,
  initialDestinationIds,
}: {
  mode: "create" | "edit";
  post?: PostView;
  authorName?: string | null;
  authorPicture?: string | null;
  linkedinReady: boolean;
  destinations: DestinationRow[];
  initialDestinationIds: string[];
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const initialSchedule = post
    ? toISTInput(post.scheduled_at)
    : nowISTInputs(60);

  const [caption, setCaption] = useState(post?.caption ?? "");
  const [hashtags, setHashtags] = useState(post?.hashtags ?? "");
  const [date, setDate] = useState(initialSchedule.date);
  const [time, setTime] = useState(initialSchedule.time);
  const [media, setMedia] = useState<MediaItem[]>(() =>
    (post?.media ?? []).map((item) => ({
      key: newKey(),
      path: item.path,
      previewUrl: item.url,
      file: null,
      name: item.path.split("/").pop() ?? "Image",
      removedExisting: false,
    })),
  );
  const [postId, setPostId] = useState(post?.id ?? null);
  const [busy, setBusy] = useState<BusyState>(null);
  const [error, setError] = useState<string | null>(null);
  const [destinationIds, setDestinationIds] = useState<string[]>(initialDestinationIds);
  const [confirming, setConfirming] = useState<"scheduled" | "publish" | null>(null);

  const isPublishingStatus = post?.status === "publishing";
  const locked = isPublishingStatus || Boolean(busy);
  const composedLengthValue = composedLength(caption, hashtags);
  const overLimit = composedLengthValue > MAX_CAPTION_LENGTH;

  const selectedDestinations = useMemo(
    () => destinations.filter((destination) => destinationIds.includes(destination.id)),
    [destinations, destinationIds],
  );

  const mediaRef = useRef(media);
  useEffect(() => {
    mediaRef.current = media;
  }, [media]);

  useEffect(() => {
    return () => {
      // Revoke every object URL created for local previews on unmount.
      mediaRef.current.forEach((item) => {
        if (item.file && item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      });
    };
  }, []);

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const incoming = Array.from(files);
      if (incoming.length === 0) return;

      const remaining = MAX_IMAGES - media.length;
      if (remaining <= 0) {
        setError(`A post can contain at most ${MAX_IMAGES} images.`);
        return;
      }

      const accepted: MediaItem[] = [];
      for (const file of incoming.slice(0, remaining)) {
        if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
          setError(`“${file.name}” is not a supported image. Use ${ALLOWED_IMAGE_LABEL}.`);
          continue;
        }
        if (file.size > MAX_IMAGE_BYTES) {
          setError(`“${file.name}” is larger than 8 MB.`);
          continue;
        }
        accepted.push(makeMediaItem(file));
      }

      if (incoming.length > remaining) {
        setError(`Only ${remaining} more image${remaining === 1 ? "" : "s"} can be added.`);
      } else {
        setError(null);
      }

      if (accepted.length > 0) setMedia((current) => [...current, ...accepted]);
    },
    [media.length],
  );

  function removeMedia(key: string) {
    setMedia((current) => {
      const target = current.find((item) => item.key === key);
      if (target?.file && target.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return current.filter((item) => item.key !== key);
    });
  }

  function moveMedia(index: number, direction: -1 | 1) {
    setMedia((current) => {
      const next = [...current];
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  const previewMedia = useMemo(
    () => media.map((item) => ({ url: item.previewUrl })),
    [media],
  );

  function validate(modeToUse: SaveMode): string | null {
    if (modeToUse !== "draft" && selectedDestinations.length === 0) {
      return destinationIds.length > 0
        ? "One or more selected destinations no longer exist. Refresh the page and choose again."
        : "Choose at least one destination before scheduling or publishing.";
    }

    if (modeToUse !== "draft") {
      const blocked = selectedDestinations.filter(
        (destination) => !isDestinationSelectable(destination),
      );
      if (blocked.length > 0) {
        return `${blocked.map((destination) => destination.name).join(", ")} cannot publish right now. Refresh destinations or reconnect LinkedIn.`;
      }
    }

    if (modeToUse !== "draft" && !composePreviewText(caption, hashtags)) {
      return "Write a caption before scheduling or publishing.";
    }

    if (overLimit) {
      return `The caption and hashtags exceed LinkedIn’s ${MAX_CAPTION_LENGTH} character limit.`;
    }

    if (modeToUse === "scheduled") {
      const iso = istInputsToUtcIso(date, time);
      if (!iso) return "Choose a valid date and time.";
      if (new Date(iso).getTime() < Date.now() - 60_000) {
        return "The scheduled time must be in the future.";
      }
    }

    return null;
  }

  async function uploadPending(id: string): Promise<{ paths: string[]; uploaded: Map<string, string> }> {
    const uploaded = new Map<string, string>();
    const orderedPaths: string[] = [];

    for (const item of media) {
      if (item.path) {
        orderedPaths.push(item.path);
        continue;
      }

      if (!item.file) continue;

      const form = new FormData();
      form.append("file", item.file);

      const response = await fetch(`/api/posts/${id}/upload`, {
        method: "POST",
        body: form,
      });

      if (!response.ok) {
        throw new Error(
          await readError(
            response,
            `“${item.name}” could not be uploaded. ${uploaded.size} of ${media.filter((entry) => entry.file).length} images were saved.`,
          ),
        );
      }

      const payload = (await response.json()) as { path: string };
      uploaded.set(item.key, payload.path);
      orderedPaths.push(payload.path);

      // Remember the stored path immediately so a retry after a later upload
      // failure does not create a duplicate object for this image.
      setMedia((current) =>
        current.map((entry) =>
          entry.key === item.key ? { ...entry, path: payload.path, file: null } : entry,
        ),
      );
    }

    return { paths: orderedPaths, uploaded };
  }

  async function persist(modeToUse: SaveMode): Promise<string | null> {
    setError(null);

    const validationError = validate(modeToUse);
    if (validationError) {
      setError(validationError);
      return null;
    }

    setBusy(modeToUse);

    try {
      let id = postId;
      const scheduledIso =
        modeToUse === "draft" ? null : istInputsToUtcIso(date, time);

      if (!id) {
        const response = await fetch("/api/posts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            caption,
            hashtags,
            scheduledAt: null,
            status: "draft",
            mediaPaths: [],
            destinationIds,
          }),
        });

        if (!response.ok) {
          throw new Error(await readError(response, "Could not create the post."));
        }

        const payload = (await response.json()) as { post: { id: string } };
        id = payload.post.id;
        setPostId(id);
      }

      const { paths, uploaded } = await uploadPending(id);

      const body: Record<string, unknown> = {
        caption,
        hashtags,
        mediaPaths: paths,
        destinationIds,
      };

      if (modeToUse === "scheduled") {
        body.status = "scheduled";
        body.scheduledAt = scheduledIso;
      } else if (modeToUse === "draft") {
        body.status = "draft";
        body.scheduledAt = null;
      }
      // For "publish", leave the status and schedule untouched until the
      // publish endpoint moves the post into the immediate queue. This avoids
      // dropping a valid schedule if the publish request itself fails.

      const response = await fetch(`/api/posts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(await readError(response, "The post could not be saved."));
      }

      setMedia((current) =>
        current.map((item) => {
          const path = item.path ?? uploaded.get(item.key) ?? null;
          return {
            ...item,
            path,
            file: null,
            previewUrl: item.previewUrl,
          };
        }),
      );

      return id;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong. Try again.");
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function onSaveDraft() {
    const id = await persist("draft");
    if (!id) return;

    toast.success("Draft saved.");
    if (mode === "create") {
      router.replace(`/queue/${id}`);
      router.refresh();
    } else {
      router.refresh();
    }
  }

  function requestSchedule() {
    setError(null);
    const validationError = validate("scheduled");
    if (validationError) {
      setError(validationError);
      return;
    }
    setConfirming("scheduled");
  }

  function requestPublish() {
    setError(null);
    if (!linkedinReady) {
      setError("LinkedIn is not connected. Connect it in Settings before publishing.");
      return;
    }
    const validationError = validate("publish");
    if (validationError) {
      setError(validationError);
      return;
    }
    setConfirming("publish");
  }

  async function onSchedule() {
    setConfirming(null);
    const id = await persist("scheduled");
    if (!id) return;

    toast.success("Post scheduled.");
    if (mode === "create") {
      router.replace(`/queue/${id}`);
      router.refresh();
    } else {
      router.refresh();
    }
  }

  async function onPublishNow() {
    setConfirming(null);

    const id = await persist("publish");
    if (!id) return;

    setBusy("publish");
    setError(null);

    try {
      const response = await fetch(`/api/posts/${id}/publish`, { method: "POST" });
      if (!response.ok) {
        throw new Error(await readError(response, "Could not start publishing."));
      }

      const payload = (await response.json()) as { warning?: string | null };
      if (payload.warning) {
        toast.message("Queued for publishing", { description: payload.warning });
      } else {
        toast.success("Publishing started.");
      }

      router.push("/queue");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start publishing.");
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
      <div className="min-w-0 space-y-5">
        {isPublishingStatus ? (
          <Alert tone="warning" title="This post is publishing">
            Editing is locked while LinkedIn processes the post. Refresh in a moment to see the
            result.
          </Alert>
        ) : null}

        <Card className="p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <Label htmlFor="caption" className="text-[13px]">
                Caption
              </Label>
              <p className="mt-1 text-[11.5px] text-muted-foreground">
                Plain text. Line breaks are preserved on LinkedIn.
              </p>
            </div>
            <span
              className={cn(
                "nums text-[11px]",
                overLimit ? "font-medium text-red-600" : "text-muted-foreground",
              )}
            >
              {composedLengthValue.toLocaleString("en-IN")} / {MAX_CAPTION_LENGTH.toLocaleString("en-IN")}
            </span>
          </div>

          <Textarea
            id="caption"
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
            placeholder="What do you want to say?"
            className="mt-3 min-h-[210px] resize-y text-[14px] leading-relaxed"
            maxLength={MAX_CAPTION_LENGTH}
            disabled={locked}
          />

          <div className="mt-4">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="hashtags" className="text-[13px]">
                Hashtags
              </Label>
              <span className="text-[11px] text-muted-foreground">Optional · added after a blank line</span>
            </div>
            <Input
              id="hashtags"
              value={hashtags}
              onChange={(event) => setHashtags(event.target.value)}
              placeholder="#buildinpublic #design"
              className="mt-3"
              maxLength={1000}
              disabled={locked}
            />
          </div>
        </Card>

        <Card className="p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[13px] font-medium">Images</p>
              <p className="mt-1 text-[11.5px] text-muted-foreground">
                {ALLOWED_IMAGE_LABEL}. Up to {MAX_IMAGES} images, published in this order.
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={locked || media.length >= MAX_IMAGES}
            >
              <ImagePlus />
              Add images
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept={ALLOWED_IMAGE_TYPES.join(",")}
              multiple
              className="hidden"
              onChange={(event) => {
                if (event.target.files) addFiles(event.target.files);
                event.target.value = "";
              }}
            />
          </div>

          {media.length > 0 ? (
            <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {media.map((item, index) => (
                <li
                  key={item.key}
                  className="group relative overflow-hidden rounded-lg border border-border bg-stone-50"
                >
                  <div className="aspect-square">
                    {item.previewUrl ? (
                      <img src={item.previewUrl} alt="" className="size-full object-cover" />
                    ) : (
                      <div className="flex size-full items-center justify-center text-[11px] text-stone-400">
                        No preview
                      </div>
                    )}
                  </div>
                  <span className="absolute left-1.5 top-1.5 rounded bg-stone-900/75 px-1.5 py-0.5 text-[10px] font-medium text-white">
                    {index + 1}
                  </span>
                  <div className="absolute inset-x-1.5 bottom-1.5 flex items-center justify-between gap-1 rounded bg-white/95 p-1 opacity-100 shadow-sm transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
                    <div className="flex gap-0.5">
                      <button
                        type="button"
                        onClick={() => moveMedia(index, -1)}
                        disabled={index === 0 || locked}
                        className="rounded p-1 text-stone-500 hover:bg-stone-100 disabled:opacity-30"
                        aria-label="Move image earlier"
                      >
                        <ArrowLeft className="size-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveMedia(index, 1)}
                        disabled={index === media.length - 1 || locked}
                        className="rounded p-1 text-stone-500 hover:bg-stone-100 disabled:opacity-30"
                        aria-label="Move image later"
                      >
                        <ArrowRight className="size-3" />
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeMedia(item.key)}
                      disabled={locked}
                      className="rounded p-1 text-red-600 hover:bg-red-50 disabled:opacity-30"
                      aria-label="Remove image"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={locked}
              className="mt-4 flex w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-stone-300 bg-stone-50/40 px-4 py-10 text-center transition-colors hover:border-stone-400 hover:bg-stone-50 disabled:opacity-60"
            >
              <UploadCloud className="size-5 text-stone-400" />
              <span className="text-[12.5px] font-medium text-stone-600">Add up to {MAX_IMAGES} images</span>
              <span className="text-[11px] text-muted-foreground">or drag them onto the picker</span>
            </button>
          )}

          <p className="mt-4 flex items-start gap-2 text-[11px] leading-relaxed text-muted-foreground">
            <Sparkles className="mt-0.5 size-3.5 shrink-0" />
            Media is stored privately and deleted automatically after your retention window once every
            destination is finished. Video is not enabled yet.
          </p>
        </Card>

        <Card className="p-5 sm:p-6">
          <DestinationSelector
            destinations={destinations}
            selectedIds={destinationIds}
            onChange={setDestinationIds}
            disabled={locked}
          />
          <p className="mt-3 flex items-start gap-2 text-[11px] leading-relaxed text-muted-foreground">
            <Share2 className="mt-0.5 size-3.5 shrink-0" />
            Each selected destination publishes independently, so one failure never blocks the
            others. Manage what Cadence can see on the{" "}
            <Link href="/destinations" className="text-primary underline-offset-4 hover:underline">
              Destinations
            </Link>{" "}
            page.
          </p>
        </Card>

        <Card className="p-5 sm:p-6">
          <div className="flex items-center gap-2">
            <CalendarClock className="size-4 text-stone-400" />
            <p className="text-[13px] font-medium">Schedule</p>
            <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] text-stone-600">
              IST
            </span>
          </div>
          <p className="mt-1 text-[11.5px] text-muted-foreground">
            Asia/Kolkata. Leave the time as-is if you are saving a draft.
          </p>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="schedule-date" className="text-[12px]">
                Date
              </Label>
              <Input
                id="schedule-date"
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                disabled={locked}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="schedule-time" className="text-[12px]">
                Time
              </Label>
              <Input
                id="schedule-time"
                type="time"
                value={time}
                onChange={(event) => setTime(event.target.value)}
                disabled={locked}
              />
            </div>
          </div>

          {date && time ? (
            <p className="mt-3 text-[11px] text-muted-foreground">
              {formatScheduleSummary(date, time)}
            </p>
          ) : null}
        </Card>

        {error ? (
          <Alert tone="danger" title="Could not continue">
            {error}
          </Alert>
        ) : null}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Link href="/queue" className={buttonVariants({ variant: "ghost" })}>
            <ArrowLeft />
            Back to queue
          </Link>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Button
              variant="secondary"
              onClick={onSaveDraft}
              disabled={locked}
            >
              {busy === "draft" ? <Loader2 className="animate-spin" /> : null}
              Save draft
            </Button>
            <Button
              variant="secondary"
              onClick={requestSchedule}
              disabled={locked}
            >
              {busy === "scheduled" ? <Loader2 className="animate-spin" /> : null}
              {post?.status === "scheduled" ? "Update schedule" : "Schedule"}
            </Button>
            <Button
              onClick={requestPublish}
              disabled={locked || !linkedinReady}
              title={linkedinReady ? undefined : "Connect LinkedIn in Settings first"}
            >
              {busy === "publish" ? <Loader2 className="animate-spin" /> : <Send />}
              Publish now
            </Button>
          </div>
        </div>

        {!linkedinReady ? (
          <p className="text-[11.5px] text-muted-foreground sm:text-right">
            <Link href="/settings" className="text-primary underline-offset-4 hover:underline">
              Connect LinkedIn
            </Link>{" "}
            to enable publishing. Drafts and scheduling still work.
          </p>
        ) : null}
      </div>

      <aside className="min-w-0">
        <div className="space-y-3 xl:sticky xl:top-8">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Live preview
            </p>
            <span className="text-[10.5px] text-muted-foreground">
              {media.length > 0 ? `${media.length} image${media.length === 1 ? "" : "s"}` : "Text only"}
            </span>
          </div>

          <LinkedInPreview
            caption={caption}
            hashtags={hashtags}
            media={previewMedia}
            authorName={authorName}
            authorPicture={authorPicture}
          />

          <div className="rounded-xl border border-border bg-white/60 p-4">
            <p className="text-[11.5px] font-medium">Before you publish</p>
            <ul className="mt-2 space-y-1.5 text-[11px] leading-relaxed text-muted-foreground">
              <li className="flex gap-2">
                <span className="text-stone-300">•</span>
                The caption and hashtags are sent exactly as previewed.
              </li>
              <li className="flex gap-2">
                <span className="text-stone-300">•</span>
                Scheduled posts are checked every minute and can take a moment to appear on LinkedIn.
              </li>
              <li className="flex gap-2">
                <span className="text-stone-300">•</span>
                If LinkedIn returns an uncertain result, Cadence will ask you to verify rather than
                posting twice.
              </li>
            </ul>
          </div>

          {post?.status === "failed" || post?.status === "manual_required" ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-[11.5px] leading-relaxed text-amber-900">
              This post previously failed. Saving it here returns it to a draft so you can review
              and reschedule. Use the Failed Posts page for retry and manual-publish options.
            </div>
          ) : null}

          {post?.status && !isPublishingStatus ? (
            <div className="flex items-center justify-between rounded-xl border border-border bg-white/60 px-4 py-3">
              <span className="text-[11.5px] text-muted-foreground">Current status</span>
              <span className="text-[11.5px] font-medium capitalize">
                {post.status.replace("_", " ")}
              </span>
            </div>
          ) : null}
        </div>
      </aside>

      <Dialog
        open={confirming !== null}
        onOpenChange={(open) => (open ? null : setConfirming(null))}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirming === "scheduled" ? "Confirm schedule" : "Confirm immediate publish"}
            </DialogTitle>
            <DialogDescription>
              {confirming === "scheduled"
                ? "Cadence creates one publishing job per destination and publishes them at the scheduled IST time."
                : "Cadence queues a separate publishing job for every destination below right now. A failure on one destination does not stop the others."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 text-[12px]">
            <div className="rounded-lg border border-border bg-stone-50/60 p-3">
              <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                Caption
              </p>
              <p className="mt-1 line-clamp-4 whitespace-pre-wrap leading-relaxed">
                {composePreviewText(caption, hashtags) || "(empty)"}
              </p>
            </div>

            {confirming === "scheduled" ? (
              <div className="flex items-start gap-2">
                <CalendarClock className="mt-0.5 size-3.5 shrink-0 text-stone-400" />
                <p>{formatScheduleSummary(date, time)}</p>
              </div>
            ) : null}

            <div>
              <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                Destinations ({selectedDestinations.length})
              </p>
              <ul className="mt-1.5 space-y-1">
                {selectedDestinations.map((destination) => (
                  <li
                    key={destination.id}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="truncate">{destination.name}</span>
                    <span className="shrink-0 text-[10.5px] text-muted-foreground">
                      {destinationTypeLabel(destination.destination_type)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <p className="text-[11px] text-muted-foreground">
              {media.length > 0
                ? `${media.length} image${media.length === 1 ? "" : "s"} attached.`
                : "No images attached."}
            </p>
          </div>

          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirming(null)}>
              Back
            </Button>
            <Button onClick={confirming === "scheduled" ? onSchedule : onPublishNow}>
              {confirming === "scheduled" ? <CalendarClock /> : <Send />}
              {confirming === "scheduled" ? "Schedule post" : "Publish now"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function formatScheduleSummary(date: string, time: string): string {
  const iso = istInputsToUtcIso(date, time);
  if (!iso) return "Choose a valid date and time.";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "Choose a valid date and time.";

  const formatted = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(parsed);

  return `Publishes ${formatted} IST.`;
}
