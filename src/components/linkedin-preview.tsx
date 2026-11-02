/* eslint-disable @next/next/no-img-element */
import { Globe2, MessageSquare, Repeat2, Send, ThumbsUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { composePreviewText } from "@/lib/preview";

function RichText({ text }: { text: string }) {
  if (!text.trim()) {
    return <span className="text-stone-400">Your caption will appear here.</span>;
  }

  const pieces = text.split(/(#[\p{L}\p{N}_]+)/gu);

  return (
    <span className="whitespace-pre-wrap">
      {pieces.map((piece, index) =>
        piece.startsWith("#") ? (
          <span key={`${piece}-${index}`} className="font-medium text-blue-700">
            {piece}
          </span>
        ) : (
          <span key={index}>{piece}</span>
        ),
      )}
    </span>
  );
}

export function LinkedInPreview({
  caption,
  hashtags,
  media,
  authorName,
  authorPicture,
  className,
}: {
  caption: string;
  hashtags: string;
  media: { url: string | null }[];
  authorName?: string | null;
  authorPicture?: string | null;
  className?: string;
}) {
  const text = composePreviewText(caption, hashtags);
  const visible = media.filter((item) => item.url);
  const hasMedia = media.length > 0;
  const extra = Math.max(0, media.length - 4);

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-border bg-white shadow-[0_1px_3px_rgba(16,24,40,0.05)]",
        className,
      )}
    >
      <div className="flex items-start gap-2.5 px-4 pb-3 pt-4">
        {authorPicture ? (
          <img
            src={authorPicture}
            alt=""
            className="size-10 shrink-0 rounded-full border border-stone-200 object-cover"
          />
        ) : (
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-stone-100 text-[13px] font-medium uppercase text-stone-500 ring-1 ring-stone-200">
            {(authorName ?? "You").slice(0, 1)}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-semibold leading-5 text-stone-900">
            {authorName || "Your profile"}
          </p>
          <p className="truncate text-[11px] leading-4 text-stone-500">LinkedIn member</p>
          <div className="mt-0.5 flex items-center gap-1 text-[10.5px] text-stone-500">
            <span>Now</span>
            <span aria-hidden>·</span>
            <Globe2 className="size-2.5" />
          </div>
        </div>
      </div>

      <div className="px-4 pb-3 text-[13px] leading-[1.5] text-stone-800">
        <p className="line-clamp-[8]">
          <RichText text={text} />
        </p>
        {text.length > 350 ? (
          <span className="mt-1 inline-block text-[12px] text-stone-500">…see more</span>
        ) : null}
      </div>

      {hasMedia ? (
        <div className="mt-0.5">
          {media.length === 1 ? (
            <div className="aspect-[1.91/1] w-full overflow-hidden bg-stone-100">
              {visible[0] ? (
                <img src={visible[0].url!} alt="" className="size-full object-cover" />
              ) : (
                <div className="flex size-full items-center justify-center text-[11px] text-stone-400">
                  Image preview unavailable
                </div>
              )}
            </div>
          ) : (
            <div className="relative grid grid-cols-2 gap-0.5 bg-stone-100">
              {media.slice(0, 4).map((item, index) => (
                <div key={index} className="aspect-square overflow-hidden bg-stone-100">
                  {item.url ? (
                    <img src={item.url} alt="" className="size-full object-cover" />
                  ) : (
                    <div className="flex size-full items-center justify-center text-[10px] text-stone-400">
                      No preview
                    </div>
                  )}
                </div>
              ))}
              {extra > 0 ? (
                <div className="pointer-events-none absolute bottom-1.5 right-1.5 rounded-md bg-stone-900/80 px-1.5 py-0.5 text-[10px] font-medium text-white">
                  +{extra}
                </div>
              ) : null}
            </div>
          )}
        </div>
      ) : null}

      <div className="mt-2 flex items-center justify-between border-t border-stone-100 px-2 py-1.5">
        {[
          { icon: ThumbsUp, label: "Like" },
          { icon: MessageSquare, label: "Comment" },
          { icon: Repeat2, label: "Repost" },
          { icon: Send, label: "Send" },
        ].map(({ icon: Icon, label }) => (
          <span
            key={label}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1.5 text-[11px] font-medium text-stone-500"
          >
            <Icon className="size-3.5" />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
