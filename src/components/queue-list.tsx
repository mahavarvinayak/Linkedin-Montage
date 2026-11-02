"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CalendarClock, FileText, ImageIcon, Plus } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { DestinationJobStrip } from "@/components/destination-badges";
import { PostActions } from "@/components/post-actions";
import { PostThumbnail } from "@/components/post-thumbnail";
import { StatusBadge } from "@/components/status-badge";
import { composePreviewText } from "@/lib/preview";
import { formatIST, formatISTTime, relativeTime } from "@/lib/ist";
import type { PostView } from "@/lib/types";
import { cn, truncate } from "@/lib/utils";

type Filter = "all" | "scheduled" | "draft" | "publishing" | "cancelled";

const filters: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "scheduled", label: "Scheduled" },
  { key: "draft", label: "Drafts" },
  { key: "publishing", label: "Publishing" },
  { key: "cancelled", label: "Cancelled" },
];

export function QueueList({ posts }: { posts: PostView[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [destinationFilter, setDestinationFilter] = useState<string>("all");

  const counts = useMemo(
    () => ({
      all: posts.length,
      scheduled: posts.filter((post) => post.status === "scheduled").length,
      draft: posts.filter((post) => post.status === "draft").length,
      publishing: posts.filter((post) => post.status === "publishing").length,
      cancelled: posts.filter((post) => post.status === "cancelled").length,
    }),
    [posts],
  );

  const availableDestinations = useMemo(() => {
    const map = new Map<string, string>();
    for (const post of posts) {
      for (const job of post.jobs ?? []) {
        if (job.destination_id) {
          const name = job.destination?.name ?? job.author_urn;
          map.set(job.destination_id, name);
        }
      }
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [posts]);

  const visible = useMemo(
    () =>
      posts.filter((post) => {
        if (filter !== "all" && post.status !== filter) return false;
        if (destinationFilter !== "all") {
          const hasDest = (post.jobs ?? []).some((job) => job.destination_id === destinationFilter);
          if (!hasDest) return false;
        }
        return true;
      }),
    [posts, filter, destinationFilter],
  );

  if (posts.length === 0) {
    return (
      <EmptyState
        icon={CalendarClock}
        title="The queue is empty"
        description="Schedule a post and it will appear here with its time, media and status. Cadence publishes due posts every minute."
        action={
          <Link href="/create" className={buttonVariants()}>
            <Plus />
            Create a post
          </Link>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1 rounded-lg border border-border bg-card p-1">
          {filters.map((item) => (
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

        {availableDestinations.length > 1 ? (
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <span className="shrink-0 text-[11px] font-medium">Destination:</span>
            <select
              value={destinationFilter}
              onChange={(e) => setDestinationFilter(e.target.value)}
              className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-[12px] font-medium text-foreground shadow-xs focus:border-stone-400 focus:outline-none"
            >
              <option value="all">All destinations</option>
              {availableDestinations.map((destination) => (
                <option key={destination.id} value={destination.id}>
                  {destination.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>

      {visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-stone-300 bg-white/60 px-5 py-12 text-center text-[12.5px] text-muted-foreground">
          No posts in this view.
        </div>
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {visible.map((post) => {
            const text = composePreviewText(post.caption, post.hashtags);
            return (
              <article key={post.id} className="p-4 sm:p-5">
                <div className="flex items-start gap-3.5">
                  <PostThumbnail
                    url={post.media[0]?.url ?? null}
                    hasMedia={post.media.length > 0}
                    size="md"
                  />

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={post.status} />
                      {post.status === "scheduled" && post.scheduled_at ? (
                        <span className="text-[11px] text-muted-foreground">
                          {formatISTTime(post.scheduled_at)} · {relativeTime(post.scheduled_at)}
                        </span>
                      ) : post.status === "draft" ? (
                        <span className="text-[11px] text-muted-foreground">
                          {post.scheduled_at ? `Draft · ${formatIST(post.scheduled_at)}` : "Draft · no time set"}
                        </span>
                      ) : post.status === "cancelled" ? (
                        <span className="text-[11px] text-muted-foreground">
                          Cancelled · will not publish
                        </span>
                      ) : post.status === "publishing" ? (
                        <span className="text-[11px] text-muted-foreground">
                          Sending to LinkedIn…
                        </span>
                      ) : null}
                      {post.attempts > 0 && post.status !== "published" ? (
                        <span className="rounded-full bg-stone-50 px-2 py-0.5 text-[10px] text-stone-500 ring-1 ring-stone-200">
                          Attempt {post.attempts} of {post.max_attempts}
                        </span>
                      ) : null}
                    </div>

                    <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-[12.5px] leading-relaxed text-stone-700">
                      {truncate(text, 320) || "No caption yet."}
                    </p>

                    {post.jobs.length > 0 ? (
                      <div className="mt-2.5">
                        <DestinationJobStrip jobs={post.jobs} />
                      </div>
                    ) : null}

                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        {post.media.length > 0 ? (
                          <>
                            <ImageIcon className="size-3" />
                            {post.media.length} image{post.media.length === 1 ? "" : "s"}
                          </>
                        ) : (
                          <>
                            <FileText className="size-3" />
                            Text only
                          </>
                        )}
                      </span>
                      {post.next_attempt_at && post.status === "scheduled" ? (
                        <span>Retry due {relativeTime(post.next_attempt_at)}</span>
                      ) : null}
                      <span>Updated {relativeTime(post.updated_at)}</span>
                    </div>

                    <div className="mt-3">
                      <PostActions post={post} context="queue" />
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
