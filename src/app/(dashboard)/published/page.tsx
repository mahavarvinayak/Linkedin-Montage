import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, ExternalLink, ImageOff, Plus } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { DestinationJobStrip } from "@/components/destination-badges";
import { PageHeader } from "@/components/page-header";
import { PostThumbnail } from "@/components/post-thumbnail";
import { CopyButton } from "@/components/copy-button";
import { listPosts } from "@/lib/queries";
import { formatIST, relativeTime } from "@/lib/ist";
import { composePreviewText } from "@/lib/preview";
import { truncate } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Published posts" };

export default async function PublishedPage() {
  const posts = await listPosts(["published"], { orderBy: "published", limit: 100 });

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Archive"
        title="Published posts"
        description="A record of everything Cadence sent to LinkedIn, plus anything you marked as published manually."
        actions={
          <Link href="/create" className={buttonVariants()}>
            <Plus />
            New post
          </Link>
        }
      />

      {posts.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="Nothing published yet"
          description="When a scheduled post goes live it will appear here with its LinkedIn link, published time and a copy of the caption."
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
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                        <CheckCircle2 className="size-3.5" />
                        Published
                      </span>
                      {post.published_at ? (
                        <>
                          <span aria-hidden>·</span>
                          <span>{formatIST(post.published_at)}</span>
                          <span aria-hidden>·</span>
                          <span>{relativeTime(post.published_at)}</span>
                        </>
                      ) : null}
                    </div>

                    <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-[12.5px] leading-relaxed text-stone-700">
                      {truncate(text, 320) || "No caption recorded."}
                    </p>

                    {post.jobs.length > 0 ? (
                      <div className="mt-2.5">
                        <DestinationJobStrip jobs={post.jobs} showLinks />
                      </div>
                    ) : null}

                    <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[10.5px] text-muted-foreground">
                      <span>
                        {post.media_type === "none"
                          ? "Text only"
                          : `${post.media.length} image${post.media.length === 1 ? "" : "s"}`}
                      </span>
                      {post.media_deleted_at ? (
                        <span className="inline-flex items-center gap-1">
                          <ImageOff className="size-3" />
                          Media removed
                        </span>
                      ) : post.media_delete_after ? (
                        <span>Media removed {formatIST(post.media_delete_after)}</span>
                      ) : null}
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {post.permalink ? (
                        <a
                          href={post.permalink}
                          target="_blank"
                          rel="noreferrer"
                          className={buttonVariants({ variant: "secondary", size: "sm" })}
                        >
                          <ExternalLink />
                          Open on LinkedIn
                        </a>
                      ) : (
                        <span className="rounded-md border border-dashed border-stone-300 px-2.5 py-1.5 text-[11px] text-muted-foreground">
                          No LinkedIn link recorded
                        </span>
                      )}
                      {text ? <CopyButton value={text} label="Copy caption" variant="secondary" /> : null}
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
