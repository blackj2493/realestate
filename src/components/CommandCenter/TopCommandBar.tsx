/**
 * TopCommandBar — compact context bar: wordmark + section nav + location search
 * (left) and alerts (right). The unified composable filter bar (persona preset
 * chip + basics + investor chips) renders below. Commute/School layers live in
 * the map panel.
 */

"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import Logo from "@/components/Logo";
import FilterBar from "./FilterBar";
import LocationSearch from "./LocationSearch";
import WatchlistAlertsBell from "@/components/watchlist/WatchlistAlertsBell";
import PrimaryNav from "@/components/layout/PrimaryNav";

interface TopCommandBarProps {
  className?: string;
}

export default function TopCommandBar({ className }: TopCommandBarProps) {
  return (
    <div className={cn("border-b border-slate-800 bg-slate-950", className)}>
      {/* Context bar */}
      <div className="flex h-12 items-center gap-4 px-4">
        {/* Left: wordmark + section nav + search */}
        <div className="flex shrink-0 items-center gap-3">
          <Link
            href="/"
            className="flex shrink-0 items-center px-3 py-1.5"
            aria-label="PureProperty.ca home"
          >
            <Logo size="md" theme="dark" />
          </Link>

          {/* Visible cross-section nav (same NAV_ITEMS as the AppHeader). */}
          <PrimaryNav variant="compact" className="hidden sm:flex" />

          <LocationSearch className="w-56 lg:w-64" />
        </div>

        {/* Flexible gap */}
        <div className="flex-1" />

        {/* Right: alerts. (Cross-section nav is the visible PrimaryNav on the
            left; the Dashboard tab there replaces the old PROFILE link.) */}
        <div className="flex shrink-0 items-center justify-end gap-3">
          <WatchlistAlertsBell />
        </div>
      </div>

      {/* Unified composable filter bar (preset + basics + investor + add) */}
      <FilterBar />
    </div>
  );
}
