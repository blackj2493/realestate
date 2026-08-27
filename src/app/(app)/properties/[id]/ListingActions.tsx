"use client";

import Link from "next/link";
import { Check, GitCompareArrows, Bookmark, BookmarkCheck, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";
import { useWatchlistStore } from "@/lib/watchlist/useWatchlist";
import ScheduleViewingForm from "@/components/Property/ScheduleViewingForm";
import CtaLadder from "@/components/Property/CtaLadder";
import type { ListingStatusKind } from "@/lib/property/listingStatus";

/**
 * Right-rail actions for the full listing page. "Add to Comparison" feeds the same
 * selection set the Command Center uses; when ≥1 is selected we surface a direct
 * link into the side-by-side comparison view (URL-driven, works on cold loads too).
 * "Add to Watchlist" persists via the cross-device watchlist store.
 */
export default function ListingActions({
  id,
  address,
  city,
  price,
  thumb,
  statusKind = "active",
  isLease = false,
}: {
  id: string;
  address?: string;
  city?: string;
  price?: number;
  thumb?: string;
  /** Drives the CTA set: on-market kinds keep Schedule Viewing; the two off-market kinds
   *  promote Watchlist instead, since a relist alert is the only useful action left.
   *  Typed off ListingStatus so a new status kind cannot be added without this compiling. */
  statusKind?: ListingStatusKind;
  /** Lease listing → the CTA ladder drops the buyer-only "2nd opinion on price" rung. */
  isLease?: boolean;
}) {
  const selectedIds = useCommandCenterStore((s) => s.selectedIds);
  const toggleSelected = useCommandCenterStore((s) => s.toggleSelected);

  const watched = useWatchlistStore((s) => !!s.items[id]);
  const toggleWatch = useWatchlistStore((s) => s.toggle);

  const isSelected = selectedIds.has(id);
  const compareIds = Array.from(selectedIds);
  const compareHref = `/properties/compare?ids=${encodeURIComponent(compareIds.join(","))}`;

  return (
    <div className="space-y-2 pt-2">
      {(statusKind === "active" || statusKind === "conditional") && (
        <>
          <CtaLadder listingKey={id} isLease={isLease} />
          {/* Shared form: rendered (event-only) so every ladder rung opens it inline. */}
          <ScheduleViewingForm listingKey={id} address={address} price={price} renderTrigger={false} />
        </>
      )}

      <button
        type="button"
        onClick={() =>
          void toggleWatch({
            listing_key: id,
            address,
            city,
            list_price: price,
            thumb,
          })
        }
        aria-pressed={watched}
        className={cn(
          "flex w-full items-center justify-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition-colors",
          (statusKind === "delisted" || statusKind === "unavailable") && !watched
            ? "border-transparent bg-emerald-600 font-semibold text-white hover:bg-emerald-700"
            : watched
              ? "border-cyan-500/40 bg-cyan-500/15 text-cyan-700 hover:bg-cyan-500/25 dark:text-cyan-300"
              : "border-border text-foreground hover:bg-muted"
        )}
      >
        {watched ? <BookmarkCheck className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
        {statusKind === "delisted"
          ? watched
            ? "Watching for a relist"
            : "Watch for a Relist"
          : watched
            ? "On your Watchlist"
            : "Add to Watchlist"}
      </button>

      <button
        type="button"
        onClick={() => toggleSelected(id)}
        aria-pressed={isSelected}
        className={cn(
          "flex w-full items-center justify-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition-colors",
          isSelected
            ? "border-cyan-500/40 bg-cyan-500/15 text-cyan-700 hover:bg-cyan-500/25 dark:text-cyan-300"
            : "border-border text-foreground hover:bg-muted"
        )}
      >
        {isSelected ? <Check className="h-4 w-4" /> : <GitCompareArrows className="h-4 w-4" />}
        {isSelected ? "Added to Comparison" : "Add to Comparison"}
      </button>

      {compareIds.length >= 1 && (
        <Link
          href={compareHref}
          className="flex w-full items-center justify-center gap-1.5 rounded-md px-4 py-2 text-xs font-semibold text-cyan-700 transition-colors hover:bg-muted dark:text-cyan-300"
        >
          Compare {compareIds.length} {compareIds.length === 1 ? "property" : "properties"}
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      )}
    </div>
  );
}
