/**
 * TopCommandBar — compact context bar: wordmark + location search (left), the
 * segmented PERSONA selector (center), and profile (right). The persona-driven
 * parameter ribbon renders below. Commute/School layers live in the map panel.
 */

"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import Logo from "@/components/Logo";
import { useCommandCenterStore, type PersonaType } from "@/lib/stores/commandCenterStore";
import { PERSONA_LIST } from "@/lib/personas/personaConfig";
import PersonaFilterBar from "./PersonaFilterBar";
import LocationSearch from "./LocationSearch";
import WatchlistAlertsBell from "@/components/watchlist/WatchlistAlertsBell";
import PrimaryNav from "@/components/layout/PrimaryNav";

interface TopCommandBarProps {
  className?: string;
}

// Short, terminal-style labels for the segmented selector.
const PERSONA_SHORT: Record<PersonaType, string> = {
  smart: "SMART HOMEBUYER",
  cashflow: "CASHFLOW INVESTOR",
  flippers: "FLIPPER",
  builders: "BUILDER",
};

export default function TopCommandBar({ className }: TopCommandBarProps) {
  const { activePersona, setActivePersona } = useCommandCenterStore();

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

        {/* Flexible gap (smaller on the left nudges the persona cluster right) */}
        <div className="flex-[2]" />

        {/* Center-right: segmented PERSONA selector */}
        <div className="flex shrink-0 items-center gap-2.5">
          <span className="text-[13px] font-semibold uppercase tracking-wider text-slate-400">
            [ Persona: ]
          </span>
          <div className="flex border border-slate-700">
            {PERSONA_LIST.map((p) => {
              const isActive = activePersona === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setActivePersona(p.id)}
                  className={cn(
                    "border-r border-slate-700 px-3.5 py-2 text-[13px] font-semibold uppercase tracking-wider transition-colors last:border-r-0",
                    isActive
                      ? "bg-cyan-400 text-slate-950"
                      : "bg-slate-950 text-slate-300 hover:bg-slate-900 hover:text-white"
                  )}
                >
                  {PERSONA_SHORT[p.id]}
                </button>
              );
            })}
          </div>
        </div>

        {/* Flexible gap (larger on the right) */}
        <div className="flex-1" />

        {/* Right: alerts. (Cross-section nav is the visible PrimaryNav on the
            left; the Dashboard tab there replaces the old PROFILE link.) */}
        <div className="flex shrink-0 items-center justify-end gap-3">
          <WatchlistAlertsBell />
        </div>
      </div>

      {/* Parameter ribbon */}
      <PersonaFilterBar />
    </div>
  );
}
