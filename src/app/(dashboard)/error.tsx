"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="max-w-md rounded-xl border border-border bg-card p-8 text-center">
        <span className="mx-auto flex size-10 items-center justify-center rounded-lg bg-red-50 text-red-600 ring-1 ring-red-100">
          <AlertTriangle className="size-4" />
        </span>
        <h2 className="mt-4 text-lg font-semibold tracking-[-0.01em]">Something went wrong</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          The dashboard couldn’t load this view. Check that your Supabase migrations have run and
          your environment variables are set.
        </p>
        {error.digest ? (
          <p className="mt-3 font-mono text-[11px] text-stone-400">Ref: {error.digest}</p>
        ) : null}
        <Button onClick={reset} className="mt-5">
          <RotateCcw />
          Try again
        </Button>
      </div>
    </div>
  );
}
