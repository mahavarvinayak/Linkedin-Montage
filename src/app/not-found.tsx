import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="max-w-md text-center">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
          404
        </p>
        <h1 className="mt-3 font-serif text-3xl tracking-[-0.02em]">Page not found</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          That page doesn’t exist in this workspace. Head back to the overview.
        </p>
        <Link href="/overview" className={`${buttonVariants()} mt-6`}>
          Go to overview
        </Link>
      </div>
    </div>
  );
}
