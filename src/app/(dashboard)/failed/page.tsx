import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Clock3, Plus } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/empty-state";
import { DestinationJobStrip } from "@/components/destination-badges";
import { JobActions } from "@/components/job-actions";
import { PageHeader } from "@/components/page-header";
import { PostActions } from "@/components/post-actions";
import { PostThumbnail } from "@/components/post-thumbnail";
import { StatusBadge } from "@/components/status-badge";
import { listPosts } from "@/lib/queries";
import { formatIST, relativeTime } from "@/lib/ist";
import { composePreviewText } from "@/lib/preview";
import { truncate } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Failed posts" };

export default async function FailedPage() {
  const posts = await listPosts(["failed", "manual_required"], { orderBy: "updated" });

  const manualCount = posts.filter((post) => post.status === "manual_required").length;

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Attention"
        title="Failed posts"
        description="Posts that did not publish. Retry transient failures, verify uncertain ones on LinkedIn, or mark a post you published yourself."
      />

      {posts.length > 0 ? (
        <Alert tone="warning" title="Check before you retry">
          A post that says “needs attention” may already exist on LinkedIn. Cadence never retries an
          uncertain publish automatically. Verify on LinkedIn first, then use the retry confirmation.
          {manualCount > 0 ? (
            <span className="mt-1 block">
              {manualCount} post{manualCount === 1 ? "" : "s"} currently need manual attention.
            </span>
          ) : null}
        </Alert>
      ) : null}

      {posts.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="Nothing needs attention"
          description="Failed publishes and uncertain outcomes will appear here with the exact error, retry count and options to recover."
          action={
            <Link href="/create" className={buttonVariants()}>
              <Plus />
              Create a post
            </Link>
          }
        />
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {posts.map((post) => {
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
                      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                        <Clock3 className="size-3" />
                        {post.last_attempt_at
                          ? `Last attempt ${relativeTime(post.last_attempt_at)}`
                          : `Updated ${relativeTime(post.updated_at)}`}
                      </span>
                      <span className="rounded-full bg-stone-50 px-2 py-0.5 text-[10px] text-stone-500 ring-1 ring-stone-200">
                        {post.attempts} of {post.max_attempts} attempts used
                      </span>
                      {post.status === "manual_required" ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-800 ring-1 ring-amber-200">
                          <AlertTriangle className="size-3" />
                          Verify on LinkedIn
                        </span>
                      ) : null}
                    </div>

                    <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-[12.5px] leading-relaxed text-stone-700">
                      {truncate(text, 320) || "No caption recorded."}
                    </p>

                    {post.jobs.length > 0 ? (
                      <div className="mt-2.5">
                        <DestinationJobStrip jobs={post.jobs} />
                      </div>
                    ) : null}

                    {post.jobs.length > 0 &&
                    post.jobs.some((job) => job.status === "failed" || job.status === "manual_required") ? (
                      <div className="mt-3 space-y-2 rounded-lg border border-border bg-stone-50/60 p-3">
                        <p className="text-[11px] font-medium text-stone-600">Per-destination recovery</p>
                        <div className="space-y-2">
                          {post.jobs
                            .filter((job) => job.status === "failed" || job.status === "manual_required")
                            .map((job) => (
                              <div
                                key={job.id}
                                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/80 bg-white p-2.5"
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2">
                                    <span className="truncate text-[12px] font-medium text-foreground">
                                      {job.destination?.name ?? job.author_urn}
                                    </span>
                                    <span className="rounded-full bg-stone-100 px-1.5 py-0.5 text-[9.5px] uppercase text-stone-600">
                                      {job.destination?.destination_type.replace(/_/g, " ") ?? "destination"}
                                    </span>
                                  </div>
                                  {job.last_error ? (
                                    <p className="mt-1 line-clamp-2 text-[11px] text-red-600">
                                      {job.last_error}
                                    </p>
                                  ) : null}
                                </div>
                                <JobActions postId={post.id} job={job} />
                              </div>
                            ))}
                        </div>
                      </div>
                    ) : null}

                    {post.last_error ? (
                      <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-[11.5px] leading-relaxed text-red-900">
                        <p className="font-medium">Last error</p>
                        <p className="mt-0.5 break-words">{post.last_error}</p>
                        {post.status === "failed" && post.next_attempt_at ? (
                          <p className="mt-1 text-red-700/80">
                            The automatic retry window ended. Manual retry is available below.
                          </p>
                        ) : null}
                      </div>
                    ) : null}

                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-muted-foreground">
                      <span>
                        {post.media_type === "none"
                          ? "Text only"
                          : `${post.media.length} image${post.media.length === 1 ? "" : "s"}`}
                      </span>
                      {post.scheduled_at ? <span>Scheduled {formatIST(post.scheduled_at)}</span> : null}
                    </div>

                    <div className="mt-3">
                      <PostActions post={post} context="failed" />
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
