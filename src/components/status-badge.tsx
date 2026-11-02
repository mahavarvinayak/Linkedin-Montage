import { STATUS_META } from "@/lib/constants";
import type { PostStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

const dotTone: Record<string, string> = {
  neutral: "bg-stone-400",
  blue: "bg-blue-500",
  green: "bg-emerald-500",
  red: "bg-red-500",
  amber: "bg-amber-500",
  gray: "bg-stone-300",
};

export function StatusBadge({
  status,
  className,
}: {
  status: PostStatus;
  className?: string;
}) {
  const meta = STATUS_META[status] ?? STATUS_META.draft;

  return (
    <Badge tone={meta.tone} className={className}>
      <span
        className={cn(
          "size-1.5 rounded-full",
          dotTone[meta.tone] ?? dotTone.neutral,
          status === "publishing" && "animate-pulse",
        )}
      />
      {meta.label}
    </Badge>
  );
}
