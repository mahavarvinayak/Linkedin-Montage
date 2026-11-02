import * as React from "react";
import { cn } from "@/lib/utils";

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "flex min-h-32 w-full resize-y rounded-md border border-input bg-card px-3 py-2.5 text-sm leading-relaxed text-foreground shadow-[0_1px_1px_rgba(16,24,40,0.02)] transition-colors placeholder:text-muted-foreground/60 focus-visible:border-blue-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
      {...props}
    />
  );
}
