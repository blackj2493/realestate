"use client";

import { Heart } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWatchlistStore, type WatchItem } from "@/lib/watchlist/useWatchlist";

/**
 * Red-heart save/unsave button backed by the shared watchlist store (anonymous
 * localStorage + signed-in Supabase). The Heart-icon counterpart to WatchButton,
 * for the absolute-positioned overlays on cards / ledger rows / map popups: pass
 * the container `className` and the heart's base `iconClassName` per surface; the
 * filled-red state is applied automatically when saved. Stops propagation so it
 * never triggers the surrounding row/link click.
 */
export default function WatchHeart({
  item,
  className,
  iconClassName,
}: {
  item: WatchItem;
  className?: string;
  iconClassName?: string;
}) {
  const watched = useWatchlistStore((s) => !!s.items[item.listing_key]);
  const toggle = useWatchlistStore((s) => s.toggle);

  return (
    <button
      type="button"
      aria-pressed={watched}
      aria-label={watched ? "Remove from saved" : "Save property"}
      title={watched ? "Remove from saved" : "Save property"}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void toggle(item);
      }}
      className={className}
    >
      <Heart className={cn(iconClassName, watched && "fill-red-500 text-red-500")} />
    </button>
  );
}
