/**
 * TopCommandBar — compact context bar:
 *   left:   wordmark + location search
 *   center: persona preset selector (residential-sale only)
 *   right:  cross-section nav + alerts
 * The unified composable filter bar (basics + investor chips) renders below.
 * Commute/School layers live in the map panel.
 */

"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import Logo from "@/components/Logo";
import FilterBar from "./FilterBar";
import LocationSearch from "./LocationSearch";
import PresetChip from "./PresetChip";
import WatchlistAlertsBell from "@/components/watchlist/WatchlistAlertsBell";
import PrimaryNav from "@/components/layout/PrimaryNav";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";
import { isInvestorLayerActive } from "@/lib/filters/fundamentals";

interface TopCommandBarProps {
  className?: string;
}

export default function TopCommandBar({ className }: TopCommandBarProps) {
  const { transactionMode, propertyClass, activeLayers } = useCommandCenterStore();
  // The persona preset is residential-sale only — rent/commercial and comp-only
  // (Sold/Leased) views are basic browse, the same gating the filter row uses.
  const compOnly = !activeLayers.has("forSale") && !activeLayers.has("forRent");
  const investorLayer = !compOnly && isInvestorLayerActive(transactionMode, propertyClass);

  return (
    <div className={cn("border-b border-slate-800 bg-slate-950", className)}>
      {/* Context bar — three columns so the persona stays centered regardless of
          the left (logo + search) and right (nav + alerts) widths. minmax(0,1fr)
          lets the side columns shrink so the search can flex and the center stays
          truly centered. */}
      {/* Mobile: a simple 3-zone flex (logo · persona · bell) so the shrink-0
          logo never overflows its track into the centered persona (audit C4).
          sm+: the centered 3-column grid (persona stays truly centered). */}
      <div className="flex h-12 items-center justify-between gap-2 px-3 sm:grid sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:gap-4 sm:px-4">
        {/* Left: wordmark + location search (search expands to fill the column) */}
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href="/"
            className="flex shrink-0 items-center px-3 py-1.5"
            aria-label="PureProperty.ca home"
          >
            <Logo size="md" theme="dark" />
          </Link>

          {/* Location search is hidden on mobile to make room for the persona. */}
          <LocationSearch className="hidden min-w-0 flex-1 sm:block" />
        </div>

        {/* Center: persona preset — the gold selector (lifted up from the filter
            row), labelled so it's clear this is the persona selector. */}
        <div className="flex items-center justify-center gap-2">
          {investorLayer && (
            <>
              <span className="hidden text-[10px] font-semibold uppercase tracking-wider text-slate-500 sm:inline">
                Persona
              </span>
              <PresetChip />
            </>
          )}
        </div>

        {/* Right: cross-section nav (same NAV_ITEMS as the AppHeader) + alerts. */}
        <div className="flex items-center justify-end gap-3">
          <PrimaryNav variant="compact" className="hidden sm:flex" />
          <WatchlistAlertsBell />
        </div>
      </div>

      {/* Unified composable filter bar (basics + investor + add) */}
      <FilterBar />
    </div>
  );
}
