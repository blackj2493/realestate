"use client";

import { Bookmark } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWatchlistStore, type WatchItem } from "@/lib/watchlist/useWatchlist";

/**
 * Save/unsave a property to the watchlist. Safe to nest inside a Link row —
 * it stops propagation so clicking it never navigates. Works anonymously
 * (localStorage) and signed-in (Supabase) via the shared store.
 *
 * Two presentations:
 * - Icon-only (default): a bare bookmark, for card/row overlays.
 * - Labeled pill (pass `label`): a bordered "Save" / "Saved" chip for prominent
 *   placement at the top of detail surfaces (terminal detail + /properties/[id]).
 */
export default function WatchButton({
  item,
  className,
  size = 16,
  label,
}: {
  item: WatchItem;
  className?: string;
  size?: number;
  /** When set, render a labeled pill ("Save" → "Saved" when watched) instead of a bare icon. */
  label?: string;
}) {
  const watched = useWatchlistStore((s) => !!s.items[item.listing_key]);
  const toggle = useWatchlistStore((s) => s.toggle);

  return (
    <button
      type="button"
      aria-pressed={watched}
      aria-label={watched ? "Remove from watchlist" : "Save to watchlist"}
      title={watched ? "Remove from watchlist" : "Save to watchlist"}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void toggle(item);
      }}
      className={cn(
        label
          ? cn(
              "inline-flex items-center justify-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
              watched
                ? "border-cyan-500/40 bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25"
                : "border-border text-foreground hover:bg-muted hover:text-cyan-300"
            )
          : cn(
              "inline-flex items-center justify-center text-muted-foreground transition-colors hover:text-cyan-300",
              watched && "text-cyan-600 dark:text-cyan-400"
            ),
        className
      )}
    >
      <Bookmark
        className={cn(watched && "fill-current")}
        style={{ width: size, height: size }}
      />
      {label && <span>{watched ? "Saved" : label}</span>}
    </button>
  );
}
