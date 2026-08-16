"use client";

import { useEffect } from "react";
import { CalendarDays } from "lucide-react";
import WatchButton from "@/components/watchlist/WatchButton";
import type { WatchItem } from "@/lib/watchlist/useWatchlist";
import { useDiscovery } from "@/lib/discovery/useDiscovery";

/**
 * Mobile-only (`lg:hidden`) sticky bottom bar for the full listing page, keeping the
 * funnel's two key actions on screen: Save (watchlist) + Contact. The right rail —
 * which holds the inline Schedule-Viewing form (active listings only) — stacks far
 * below the fold on mobile, so without this the actions are effectively unreachable.
 *
 * Contact dispatches the same `pp:open-viewing` event the ScheduleViewingForm in
 * ListingActions listens for, so it opens + scrolls into view. When the listing can't
 * be contacted (sold / delisted → no viewing form), Save takes the full width.
 */
export default function MobileActionBar({
  item,
  listingKey,
  canContact,
}: {
  item: WatchItem;
  listingKey: string;
  canContact: boolean;
}) {
  // #10 FAB overlap: this sticky bar and the discovery Guide FAB both pin to the bottom
  // (the FAB bottom-right), so on mobile they collide. Ref-count a chrome-block so the FAB
  // hides while the bar is visible. The bar is `lg:hidden` CSS but mounts on ALL viewports,
  // so a bare mount-effect would also hide the FAB on desktop (where the bar isn't shown) —
  // gate the block on the same <lg breakpoint that governs the bar's visibility.
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023.98px)");
    let blocking = false;
    const sync = () => {
      const { blockChrome, unblockChrome } = useDiscovery.getState();
      if (mq.matches && !blocking) {
        blockChrome();
        blocking = true;
      } else if (!mq.matches && blocking) {
        unblockChrome();
        blocking = false;
      }
    };
    sync();
    mq.addEventListener("change", sync);
    return () => {
      mq.removeEventListener("change", sync);
      if (blocking) useDiscovery.getState().unblockChrome();
    };
  }, []);

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-40 flex items-center gap-2 border-t border-border bg-background/95 px-3 pt-2.5 backdrop-blur lg:hidden"
      style={{ paddingBottom: "calc(0.625rem + env(safe-area-inset-bottom))" }}
    >
      <WatchButton
        item={item}
        label="Save"
        className={canContact ? "min-h-[44px]" : "min-h-[44px] flex-1 justify-center"}
      />
      {canContact && (
        <button
          type="button"
          onClick={() =>
            window.dispatchEvent(
              new CustomEvent("pp:open-viewing", { detail: { listingKey } })
            )
          }
          className="flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700"
        >
          <CalendarDays className="h-4 w-4" />
          Book a viewing
        </button>
      )}
    </div>
  );
}
