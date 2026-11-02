"use client";

import { useMemo, useState } from "react";
import { Check, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DESTINATION_STATUS_META,
  TONE_CLASSES,
  TONE_DOTS,
  destinationBlockedReason,
  destinationTypeLabel,
  isDestinationSelectable,
} from "@/lib/destinations";
import type { DestinationRow } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Searchable, dynamic destination picker. It renders whatever the destination
 * table contains: nothing here assumes a fixed account list.
 */
export function DestinationSelector({
  destinations,
  selectedIds,
  onChange,
  disabled = false,
}: {
  destinations: DestinationRow[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectable = useMemo(
    () => destinations.filter((destination) => isDestinationSelectable(destination)),
    [destinations],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return destinations;
    return destinations.filter((destination) => {
      const haystack = [
        destination.name,
        destination.author_urn,
        destinationTypeLabel(destination.destination_type),
        destination.member_role ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [destinations, query]);

  const selectedDestinations = destinations.filter((destination) =>
    selectedSet.has(destination.id),
  );

  function toggle(id: string) {
    if (disabled) return;
    if (selectedSet.has(id)) {
      onChange(selectedIds.filter((value) => value !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  }

  function selectAll() {
    if (disabled) return;
    onChange(selectable.map((destination) => destination.id));
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <p className="text-[13px] font-medium">Destinations</p>
          <span className="text-[11px] text-muted-foreground">
            {selectedIds.length} selected
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={selectAll}
            disabled={disabled || selectable.length === 0}
          >
            Select all available
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange([])}
            disabled={disabled || selectedIds.length === 0}
          >
            Clear
          </Button>
        </div>
      </div>

      {selectedDestinations.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {selectedDestinations.map((destination) => {
            const meta = DESTINATION_STATUS_META[destination.status];
            return (
              <span
                key={destination.id}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border py-0.5 pl-2 pr-1 text-[11px]",
                  TONE_CLASSES[meta.tone] ?? TONE_CLASSES.neutral,
                )}
              >
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    TONE_DOTS[meta.tone] ?? TONE_DOTS.neutral,
                  )}
                />
                {destination.name}
                <button
                  type="button"
                  onClick={() => toggle(destination.id)}
                  disabled={disabled}
                  aria-label={`Remove ${destination.name}`}
                  className="rounded-full p-0.5 opacity-60 transition-opacity hover:opacity-100 disabled:opacity-30"
                >
                  <X className="size-3" />
                </button>
              </span>
            );
          })}
        </div>
      ) : (
        <p className="text-[11.5px] text-muted-foreground">
          Pick at least one destination to schedule or publish this post.
        </p>
      )}

      <div className="overflow-hidden rounded-lg border border-border">
        <div className="relative border-b border-border">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-stone-400" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search destinations by name, type or URN"
            className="h-9 rounded-none border-0 pl-8 text-[12px] shadow-none focus-visible:ring-0"
            disabled={disabled}
            aria-label="Search destinations"
          />
        </div>

        <ul className="max-h-64 divide-y divide-border overflow-y-auto">
          {filtered.length === 0 ? (
            <li className="px-3 py-6 text-center text-[11.5px] text-muted-foreground">
              No destinations match “{query}”.
            </li>
          ) : (
            filtered.map((destination) => {
              const selectableDestination = isDestinationSelectable(destination);
              const blockedReason = destinationBlockedReason(destination);
              const checked = selectedSet.has(destination.id);
              const meta = DESTINATION_STATUS_META[destination.status];

              return (
                <li key={destination.id}>
                  <label
                    className={cn(
                      "flex cursor-pointer items-start gap-2.5 px-3 py-2.5 transition-colors",
                      selectableDestination
                        ? "hover:bg-stone-50/70"
                        : "cursor-not-allowed bg-stone-50/40",
                      disabled && "cursor-not-allowed",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border",
                        checked
                          ? "border-blue-600 bg-blue-600 text-white"
                          : "border-stone-300 bg-white",
                        !selectableDestination && "border-stone-200 bg-stone-100",
                      )}
                    >
                      {checked ? <Check className="size-3" /> : null}
                    </span>
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={checked}
                      disabled={disabled || !selectableDestination}
                      onChange={() => toggle(destination.id)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span
                          className={cn(
                            "truncate text-[12.5px]",
                            selectableDestination ? "text-foreground" : "text-stone-500",
                          )}
                        >
                          {destination.name}
                        </span>
                        <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[9.5px] uppercase tracking-[0.08em] text-stone-500">
                          {destinationTypeLabel(destination.destination_type)}
                        </span>
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9.5px]",
                            TONE_CLASSES[meta.tone] ?? TONE_CLASSES.neutral,
                          )}
                        >
                          <span
                            className={cn(
                              "size-1 rounded-full",
                              TONE_DOTS[meta.tone] ?? TONE_DOTS.neutral,
                            )}
                          />
                          {meta.label}
                        </span>
                      </span>
                      <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground">
                        {destination.author_urn}
                      </span>
                      {!selectableDestination && blockedReason ? (
                        <span className="mt-1 block text-[10.5px] leading-relaxed text-amber-800">
                          {blockedReason}
                        </span>
                      ) : null}
                    </span>
                  </label>
                </li>
              );
            })
          )}
        </ul>
      </div>

      {destinations.length === 0 ? (
        <p className="text-[11px] leading-relaxed text-amber-800">
          No destinations have been discovered yet. Open Destinations and run Refresh destinations
          after connecting LinkedIn.
        </p>
      ) : selectable.length === 0 ? (
        <p className="text-[11px] leading-relaxed text-amber-800">
          None of the discovered destinations is authorized for publishing. Check the required
          LinkedIn scopes on the Destinations page.
        </p>
      ) : null}
    </div>
  );
}
