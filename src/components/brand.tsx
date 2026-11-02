import Link from "next/link";
import { cn } from "@/lib/utils";

export function Brand({ className, markOnly = false }: { className?: string; markOnly?: boolean }) {
  return (
    <Link
      href="/overview"
      className={cn("inline-flex items-center gap-2.5 outline-none", className)}
      aria-label="Cadence home"
    >
      <span className="flex size-7 shrink-0 items-center justify-center rounded-[7px] bg-stone-900 text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
        <span className="font-serif text-[15px] leading-none">C</span>
      </span>
      {markOnly ? null : (
        <span className="font-serif text-[19px] leading-none tracking-[-0.015em] text-foreground">
          Cadence
        </span>
      )}
    </Link>
  );
}
