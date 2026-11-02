import Link from "next/link";
import {
  Activity,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  CircleAlert,
  Clock3,
  FileText,
  ImageIcon,
  PenLine,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { DestinationJobStrip } from "@/components/destination-badges";
import { LinkHealthBanner } from "@/components/link-health-banner";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { StatCard } from "@/components/stat-card";
import { getIntegrationStatus, getOverviewData } from "@/lib/queries";
import { formatIST, formatISTTime, relativeTime } from "@/lib/ist";
import { truncate } from "@/lib/utils";
import { composePreviewText } from "@/lib/preview";

export const dynamic = "force-dynamic";

function eventMeta(eventType: string) {
  switch (eventType) {
    case "published":
    case "manual_published":
      return { Icon: CheckCircle2, tone: "text-emerald-600 bg-emerald-50", title: "Published to LinkedIn" };
    case "publish_started":
      return { Icon: Clock3, tone: "text-blue-600 bg-blue-50", title: "Publishing started" };
    case "publish_retry_scheduled":
      return { Icon: RefreshCw, tone: "text-amber-600 bg-amber-50", title: "Retry scheduled" };
    case "publish_failed":
      return { Icon: CircleAlert, tone: "text-red-600 bg-red-50", title: "Publishing failed" };
    case "manual_required":
      return { Icon: CircleAlert, tone: "text-amber-600 bg-amber-50", title: "Needs manual attention" };
    case "media_cleanup":
    case "orphan_media_cleanup":
      return { Icon: Trash2, tone: "text-stone-500 bg-stone-100", title: "Media cleaned up" };
    case "media_cleanup_failed":
      return { Icon: CircleAlert, tone: "text-red-600 bg-red-50", title: "Media cleanup failed" };
    case "linkedin_connected":
      return { Icon: CheckCircle2, tone: "text-blue-600 bg-blue-50", title: "LinkedIn connected" };
    case "linkedin_disconnected":
      return { Icon: CircleAlert, tone: "text-stone-500 bg-stone-100", title: "LinkedIn disconnected" };
    case "post_scheduled":
      return { Icon: CalendarClock, tone: "text-blue-600 bg-blue-50", title: "Post scheduled" };
    case "post_created":
      return { Icon: PenLine, tone: "text-stone-500 bg-stone-100", title: "Post created" };
    case "publish_requested":
      return { Icon: Clock3, tone: "text-blue-600 bg-blue-50", title: "Immediate publish requested" };
    default:
      return { Icon: Activity, tone: "text-stone-500 bg-stone-100", title: "Activity" };
  }
}

export default async function OverviewPage() {
  const [data, integration] = await Promise.all([getOverviewData(), getIntegrationStatus()]);
  const next = data.upcoming[0] ?? null;
  const upcoming = data.upcoming.slice(1);
  const monthName = new Intl.DateTimeFormat("en-IN", {
    month: "long",
    timeZone: "Asia/Kolkata",
  }).format(new Date());
  const nextMedia = next?.media[0]?.url ?? null;
  const nextText = next ? composePreviewText(next.caption, next.hashtags) : "";

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Workspace"
        title="Overview"
        description={`A quiet view of what’s queued, what’s live and what needs your attention. All times are in IST.`}
        actions={
          <Link href="/create" className={buttonVariants()}>
            <Plus />
            New post
          </Link>
        }
      />

      <LinkHealthBanner status={integration} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Scheduled"
          value={data.counts.scheduled}
          hint="Waiting in the queue"
          icon={CalendarClock}
          accent="blue"
        />
        <StatCard
          label="Published this month"
          value={data.counts.publishedThisMonth}
          hint={`Since 1 ${monthName}`}
          icon={CheckCircle2}
          accent="green"
        />
        <StatCard
          label="Failed"
          value={data.counts.failed}
          hint="Needs attention or a retry"
          icon={CircleAlert}
          accent={data.counts.failed > 0 ? "red" : "neutral"}
        />
        <StatCard
          label="Drafts"
          value={data.counts.drafts}
          hint="Unfinished posts"
          icon={FileText}
          accent="neutral"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <section className="min-w-0 space-y-4">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Up next
              </p>
              <h2 className="mt-1 text-[17px] font-semibold tracking-[-0.015em]">
                Next scheduled post
              </h2>
            </div>
            <Link
              href="/queue"
              className="inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"
            >
              Queue <ArrowRight className="size-3.5" />
            </Link>
          </div>

          {next ? (
            <Card className="overflow-hidden">
              <div className="grid sm:grid-cols-[210px_minmax(0,1fr)]">
                <div className="relative min-h-[180px] border-b border-border bg-stone-50 sm:border-b-0 sm:border-r">
                  {nextMedia ? (
                    <img
                      src={nextMedia}
                      alt=""
                      className="absolute inset-0 size-full object-cover"
                    />
                  ) : (
                    <div className="flex size-full min-h-[180px] flex-col items-center justify-center gap-2 px-6 text-center">
                      {next.media.length > 0 ? (
                        <ImageIcon className="size-5 text-stone-300" />
                      ) : (
                        <FileText className="size-5 text-stone-300" />
                      )}
                      <span className="text-[11px] text-stone-400">
                        {next.media.length > 0 ? "Preview unavailable" : "Text-only post"}
                      </span>
                    </div>
                  )}
                  <div className="absolute left-3 top-3">
                    <StatusBadge status={next.status} />
                  </div>
                </div>

                <div className="flex min-w-0 flex-col p-5">
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {next.scheduled_at ? formatIST(next.scheduled_at) : "No time set"}
                    </span>
                    {next.scheduled_at ? (
                      <span className="rounded-full bg-stone-100 px-2 py-0.5">
                        {relativeTime(next.scheduled_at)}
                      </span>
                    ) : null}
                  </div>

                  <p className="mt-3 line-clamp-4 whitespace-pre-wrap text-[13.5px] leading-relaxed text-stone-700">
                    {nextText || "No caption yet."}
                  </p>

                  {next.jobs.length > 0 ? (
                    <div className="mt-3">
                      <DestinationJobStrip jobs={next.jobs} />
                    </div>
                  ) : null}

                  <div className="mt-auto flex flex-wrap items-center gap-2 pt-5">
                    <Link
                      href={`/queue/${next.id}`}
                      className={buttonVariants({ variant: "secondary", size: "sm" })}
                    >
                      <PenLine />
                      Edit post
                    </Link>
                    <Link
                      href="/queue"
                      className={buttonVariants({ variant: "ghost", size: "sm" })}
                    >
                      View queue
                    </Link>
                    {next.media.length > 0 ? (
                      <span className="ml-auto text-[10.5px] text-muted-foreground">
                        {next.media.length} image{next.media.length === 1 ? "" : "s"}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            </Card>
          ) : (
            <EmptyState
              icon={CalendarClock}
              title="Nothing is scheduled"
              description="Prepare a post now and pick a time. Cadence will hold it in the queue and publish it for you."
              action={
                <Link href="/create" className={buttonVariants()}>
                  <Plus />
                  Create a post
                </Link>
              }
            />
          )}

          <div className="pt-2">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-[13px] font-semibold tracking-[-0.01em]">Upcoming queue</h3>
              <span className="text-[11px] text-muted-foreground">
                {upcoming.length} more
              </span>
            </div>

            {upcoming.length > 0 ? (
              <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
                {upcoming.map((post) => (
                  <Link
                    key={post.id}
                    href={`/queue/${post.id}`}
                    className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-stone-50/70"
                  >
                    <div className="size-10 shrink-0 overflow-hidden rounded-md border border-border bg-stone-50">
                      {post.media[0]?.url ? (
                        <img src={post.media[0].url} alt="" className="size-full object-cover" />
                      ) : (
                        <div className="flex size-full items-center justify-center text-stone-300">
                          <FileText className="size-3.5" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12.5px] text-stone-700">
                        {truncate(
                          composePreviewText(post.caption, post.hashtags) || "Untitled draft",
                          90,
                        )}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span className="text-[10.5px] text-muted-foreground">
                          {post.scheduled_at
                            ? `${formatISTTime(post.scheduled_at)} · ${relativeTime(post.scheduled_at)}`
                            : "No time set"}
                        </span>
                        {post.jobs.length > 0 ? (
                          <DestinationJobStrip jobs={post.jobs} compact />
                        ) : null}
                      </div>
                    </div>
                    <StatusBadge status={post.status} />
                  </Link>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-stone-300 px-4 py-5 text-center text-[12px] text-muted-foreground">
                Nothing else in the pipeline.
              </div>
            )}
          </div>
        </section>

        <section className="min-w-0">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[15px] font-semibold tracking-[-0.015em]">Recent activity</h2>
            <span className="flex items-center gap-1 text-[10.5px] text-muted-foreground">
              <Activity className="size-3" />
              Live log
            </span>
          </div>

          <Card className="overflow-hidden">
            {data.logs.length > 0 ? (
              <ul className="divide-y divide-border">
                {data.logs.map((log) => {
                  const meta = eventMeta(log.event_type);
                  const caption = log.post?.caption
                    ? truncate(composePreviewText(log.post.caption, ""), 70)
                    : truncate(log.message, 70);

                  return (
                    <li key={log.id} className="flex gap-3 px-4 py-3">
                      <span
                        className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md ${meta.tone}`}
                      >
                        <meta.Icon className="size-3.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[12px] font-medium text-foreground">{meta.title}</p>
                        <p className="mt-0.5 line-clamp-1 text-[11.5px] text-muted-foreground">
                          {caption || "No detail recorded"}
                        </p>
                      </div>
                      <span className="shrink-0 whitespace-nowrap text-[10px] text-stone-400">
                        {relativeTime(log.created_at)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="px-5 py-12 text-center">
                <p className="text-[12.5px] text-muted-foreground">
                  Publishing activity will appear here.
                </p>
              </div>
            )}
          </Card>

          <div className="mt-4 rounded-xl border border-border bg-white/60 p-4">
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 flex size-6 items-center justify-center rounded-md bg-stone-100 text-stone-500">
                <Clock3 className="size-3" />
              </span>
              <div>
                <p className="text-[11.5px] font-medium">Times shown in IST</p>
                <p className="mt-0.5 text-[10.5px] leading-relaxed text-muted-foreground">
                  Asia/Kolkata (UTC+05:30). The scheduler checks for due posts every minute.
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
