import { ExternalLink } from "lucide-react";
import {
  JOB_STATUS_META,
  TONE_CLASSES,
  TONE_DOTS,
  destinationTypeShort,
} from "@/lib/destinations";
import type { PostJobView } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Compact per-destination status chips. The list is driven entirely by the
 * post's jobs, so it adapts to any number of destinations without UI changes.
 */
export function DestinationJobStrip({
  jobs,
  compact = false,
  showLinks = false,
  emptyLabel = "No destinations selected",
  className,
}: {
  jobs: PostJobView[];
  compact?: boolean;
  showLinks?: boolean;
  emptyLabel?: string;
  className?: string;
}) {
  if (jobs.length === 0) {
    return <span className={cn("text-[10.5px] text-muted-foreground", className)}>{emptyLabel}</span>;
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {jobs.map((job) => {
        const meta = JOB_STATUS_META[job.status];
        const name = job.destination?.name ?? job.author_urn;
        const title = [
          `${name} · ${destinationTypeShort(job.destination?.destination_type)}`,
          meta.label,
          job.attempts > 0 ? `Attempt ${job.attempts} of ${job.max_attempts}` : null,
          job.last_error,
        ]
          .filter(Boolean)
          .join(" · ");

        return (
          <span
            key={job.id}
            title={title}
            className={cn(
              "inline-flex min-w-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10.5px]",
              TONE_CLASSES[meta.tone] ?? TONE_CLASSES.neutral,
            )}
          >
            <span
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                TONE_DOTS[meta.tone] ?? TONE_DOTS.neutral,
              )}
            />
            <span className="max-w-[180px] truncate font-medium">{name}</span>
            {compact ? null : (
              <span className="shrink-0 opacity-70">{meta.label}</span>
            )}
            {showLinks && job.permalink ? (
              <a
                href={job.permalink}
                target="_blank"
                rel="noreferrer"
                aria-label={`Open ${name} post on LinkedIn`}
                className="shrink-0 opacity-70 hover:opacity-100"
              >
                <ExternalLink className="size-2.5" />
              </a>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}
