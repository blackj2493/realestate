"use client";

import { Bookmark } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWatchlistStore, type WatchItem } from "@/lib/watchlist/useWatchlist";

/**
 * Save/unsave a property to the watchlist. Safe to nest inside a Link row —
 * it stops propagation so clicking it never navigates. Works anonymously
 * (localStorage) and signed-in (Supabase) via the shared store.
 */
export default function WatchButton({
  item,
  className,
  size = 16,
}: {
  item: WatchItem;
  className?: string;
  size?: number;
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
        "inline-flex items-center justify-center text-slate-500 transition-colors hover:text-cyan-300",
        watched && "text-cyan-400",
        className
      )}
    >
      <Bookmark
        className={cn(watched && "fill-current")}
        style={{ width: size, height: size }}
      />
    </button>
  );
}
