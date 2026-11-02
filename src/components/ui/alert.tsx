import * as React from "react";
import { AlertCircle, CheckCircle2, Info, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

type Tone = "info" | "success" | "warning" | "danger";

const tones: Record<Tone, { className: string; Icon: typeof Info }> = {
  info: { className: "border-blue-200 bg-blue-50/70 text-blue-950", Icon: Info },
  success: { className: "border-emerald-200 bg-emerald-50/70 text-emerald-950", Icon: CheckCircle2 },
  warning: { className: "border-amber-200 bg-amber-50/80 text-amber-950", Icon: TriangleAlert },
  danger: { className: "border-red-200 bg-red-50/70 text-red-950", Icon: AlertCircle },
};

export function Alert({
  tone = "info",
  title,
  children,
  className,
  action,
}: {
  tone?: Tone;
  title: string;
  children?: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
}) {
  const { className: toneClass, Icon } = tones[tone];

  return (
    <div className={cn("rounded-lg border p-3.5", toneClass, className)}>
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 size-4 shrink-0 opacity-80" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium">{title}</p>
          {children ? <div className="mt-1 text-[13px] leading-relaxed opacity-80">{children}</div> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    </div>
  );
}
