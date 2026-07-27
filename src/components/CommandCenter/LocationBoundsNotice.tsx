"use client";

/**
 * LocationBoundsNotice — the out-of-bounds escape hatch for a place-filtered map.
 *
 * Appears only when the viewport holds active listings that the place filter is hiding
 * (see useHiddenByLocation). Says WHAT is happening before offering the fix: a bare
 * "Search this area" assumes the user has already worked out that a filter is the reason
 * their map is empty, which is exactly the thing they haven't worked out.
 *
 * This is DERIVED state, not a dismissible notice. It is recomputed from the live
 * location + viewport every render, so panning back onto the searched city removes it on
 * its own. There is deliberately no close button: nothing is stored, so nothing can get
 * stuck shown or stuck hidden.
 *
 * Placed top-center over the map, clear of MapControlRail (left) and SaveBubbleButton
 * (right). Must stay pointer-events-none at the wrapper level — overlays that blanket
 * AlphaMap swallow deck.gl clicks (see the terminal overlay notes).
 */

import React from "react";
import { Search } from "lucide-react";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";
import { useHiddenByLocation } from "@/hooks/useHiddenByLocation";

export default function LocationBoundsNotice() {
  const location = useCommandCenterStore((s) => s.location);
  const searchVisibleArea = useCommandCenterStore((s) => s.searchVisibleArea);
  const hidden = useHiddenByLocation();

  if (!hidden) return null;

  const place = location.trim();

  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 z-30 flex justify-center px-3">
      <button
        type="button"
        onClick={searchVisibleArea}
        className="pointer-events-auto inline-flex min-h-[36px] max-w-full items-center gap-2 border border-cyan-500/60 bg-slate-900/95 px-3.5 py-1.5 text-cyan-300 shadow-lg backdrop-blur transition-colors hover:border-cyan-400 hover:bg-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400"
      >
        <Search className="h-3.5 w-3.5 shrink-0" />
        <span className="terminal-font truncate text-[11px] uppercase tracking-wider">
          {/* Diagnosis first, action second — and the count makes the cost concrete. */}
          <span className="text-slate-300">Showing {place} only</span>
          <span className="mx-1.5 text-slate-500">·</span>
          {hidden.toLocaleString()} more here
        </span>
      </button>
    </div>
  );
}
