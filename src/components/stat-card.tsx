import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  accent,
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  icon?: LucideIcon;
  accent?: "blue" | "green" | "red" | "neutral";
  className?: string;
}) {
  const iconTone = {
    blue: "bg-blue-50 text-blue-700 ring-blue-100",
    green: "bg-emerald-50 text-emerald-700 ring-emerald-100",
    red: "bg-red-50 text-red-700 ring-red-100",
    neutral: "bg-stone-50 text-stone-500 ring-stone-200",
  }[accent ?? "neutral"];

  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card p-5 shadow-[0_1px_2px_rgba(16,24,40,0.03)]",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
          {label}
        </p>
        {Icon ? (
          <span className={cn("flex size-7 items-center justify-center rounded-md ring-1", iconTone)}>
            <Icon className="size-3.5" />
          </span>
        ) : null}
      </div>
      <p className="nums mt-4 font-serif text-[34px] leading-none tracking-[-0.02em] text-foreground">
        {value}
      </p>
      {hint ? <p className="mt-2.5 text-[11.5px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
