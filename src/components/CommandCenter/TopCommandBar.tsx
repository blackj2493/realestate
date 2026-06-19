/**
 * TopCommandBar — compact context bar:
 *   left:   wordmark + location search
 *   center: persona preset selector (residential-sale only)
 *   right:  cross-section nav + alerts
 * The unified composable filter bar (basics + investor chips) renders below.
 * Commute/School layers live in the map panel.
 */

"use client";

import React from "react";
import Link from "next/link";
import { Search, X } from "lucide-react";
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

  // Mobile-only search overlay. The inline LocationSearch is `hidden sm:block`,
  // so on phones (<640px) there is otherwise no way to search the terminal.
  // We reuse the SAME LocationSearch component inside a full-width sheet rather
  // than reimplementing search. Close on Done/X, backdrop tap, or Escape.
  const [searchOpen, setSearchOpen] = React.useState(false);

  React.useEffect(() => {
    if (!searchOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSearchOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [searchOpen]);

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
          {/* Mobile-only search trigger — the inline LocationSearch is hidden
              below sm, so this is the only way to search on phones. 44px tap
              target, dark terminal styling. */}
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            aria-label="Search listings"
            className="flex h-11 w-11 shrink-0 items-center justify-center text-slate-400 hover:text-slate-200 sm:hidden"
          >
            <Search className="h-5 w-5" />
          </button>
          <PrimaryNav variant="compact" className="hidden sm:flex" />
          <WatchlistAlertsBell />
        </div>
      </div>

      {/* Mobile-only full-width search sheet. Reuses the SAME LocationSearch
          (inplace mode → drives the live terminal search). Backdrop tap or the
          Done button closes it; Escape is handled in the effect above. */}
      {searchOpen && (
        <div className="fixed inset-0 z-[60] flex flex-col sm:hidden" role="dialog" aria-modal="true" aria-label="Search listings">
          {/* Backdrop — outside tap closes. */}
          <button
            type="button"
            aria-label="Close search"
            onClick={() => setSearchOpen(false)}
            className="absolute inset-0 bg-slate-950/80"
          />
          <div className="relative border-b border-slate-800 bg-slate-950 px-3 pb-3 pt-3">
            <div className="flex items-center gap-2">
              <LocationSearch className="min-w-0 flex-1" />
              <button
                type="button"
                onClick={() => setSearchOpen(false)}
                aria-label="Close search"
                className="flex h-11 min-w-[44px] shrink-0 items-center justify-center px-3 font-mono text-xs uppercase tracking-wider text-slate-400 hover:text-slate-200"
              >
                <X className="mr-1 h-4 w-4" />
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Unified composable filter bar (basics + investor + add) */}
      <FilterBar />
    </div>
  );
}
