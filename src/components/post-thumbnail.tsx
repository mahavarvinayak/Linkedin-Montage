import { FileText, ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function PostThumbnail({
  url,
  hasMedia,
  size = "md",
  className,
}: {
  url?: string | null;
  hasMedia?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const dimensions = {
    sm: "size-10 rounded-md",
    md: "size-14 rounded-lg",
    lg: "size-20 rounded-lg",
  }[size];

  return (
    <div
      className={cn(
        "relative shrink-0 overflow-hidden border border-border bg-stone-50",
        dimensions,
        className,
      )}
    >
      {url ? (
        // Signed Supabase URLs are short-lived and dynamic; next/image is not a
        // good fit for private, per-request URLs.
        <img src={url} alt="" className="size-full object-cover" loading="lazy" />
      ) : (
        <div className="flex size-full items-center justify-center text-stone-400">
          {hasMedia ? <ImageIcon className="size-4" /> : <FileText className="size-4" />}
        </div>
      )}
    </div>
  );
}
