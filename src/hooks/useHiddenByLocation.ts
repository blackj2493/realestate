"use client";

/**
 * How many active listings the CURRENT VIEWPORT contains that the place filter is
 * hiding — the signal behind the terminal's out-of-bounds notice.
 *
 * The terminal's `location` is a Typesense text query, not a viewport constraint. Search
 * "Toronto", drag the map to Oakville, and every Oakville listing fails the text match:
 * the map empties with nothing on screen explaining why. The escape (clearing the search
 * box) is invisible unless you already know it exists.
 *
 * Rather than guess from an empty result set, this asks directly: run the same viewport
 * query twice, once with the place term and once without, and diff the counts. Two
 * count-only probes (perPage 1, no facets) and only while a place filter is active —
 * `location` is empty by default, so an exploring user never triggers them.
 *
 * Diffing counts rather than testing for zero is deliberate. If a viewport happens to
 * hold two stray Toronto listings, a zero-check stays silent and the user reads those two
 * as the whole market. Partial blindness is worse than an empty map, because it looks
 * like an answer.
 *
 * The core clauses (beds, price, type…) are applied to BOTH probes so the difference is
 * attributable to place alone — never to filters the user set on purpose.
 */

import { useEffect, useState } from "react";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";
import { buildTerminalCoreClauses } from "@/lib/filters/terminalQuery";
import { searchListings } from "@/lib/typesense/client";

/** Matches the search debounce in the terminal so the notice settles with the results. */
const PROBE_DEBOUNCE_MS = 400;

/**
 * Share of the in-view inventory that must be hidden before we say anything.
 *
 * "Anything at all is hidden" is far too low a bar in a dense metro: a Toronto search
 * framed on Toronto still catches Vaughan and Markham at the edges, so the notice would
 * sit on screen permanently and read as nagging rather than helpful. Measured on the GTA:
 * centred on Toronto ≈ 7% hidden, dragged half a screen west ≈ 32%, fully off the city
 * ≈ 90%+. Requiring the hidden half to be the MAJORITY of what's in view keeps it quiet
 * until the map really has stopped answering the question the user is looking at.
 */
const HIDDEN_SHARE_THRESHOLD = 0.5;

export function useHiddenByLocation(): number {
  const location = useCommandCenterStore((s) => s.location);
  const mapBounds = useCommandCenterStore((s) => s.mapBounds);
  const transactionMode = useCommandCenterStore((s) => s.transactionMode);
  const propertyClass = useCommandCenterStore((s) => s.propertyClass);
  const universalFilters = useCommandCenterStore((s) => s.universalFilters);
  const filters = useCommandCenterStore((s) => s.filters);
  const activeLayers = useCommandCenterStore((s) => s.activeLayers);

  const [hidden, setHidden] = useState(0);

  const place = location.trim();
  // Comp-only views (Sold/Leased with no For Sale/Rent layer) are served by the gated
  // comps route, not this Typesense query — the notice would be measuring the wrong thing.
  const hasActiveLayer = activeLayers.has("forSale") || activeLayers.has("forRent");
  // Whether a probe is meaningful at all. Gating the RETURN on this (rather than zeroing
  // state inside the effect) keeps the reset a derivation instead of a cascading render.
  const active = Boolean(place) && Boolean(mapBounds) && hasActiveLayer;

  useEffect(() => {
    // Re-test mapBounds rather than leaning on `active` — a boolean doesn't narrow it.
    const bounds = mapBounds;
    if (!active || !bounds) return;

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const rawFilterBy = buildTerminalCoreClauses({
          transactionMode,
          propertyClass,
          universalFilters,
          filters,
        }).join(" && ");
        const probe = { rawFilterBy, filters: { boundingBox: bounds }, perPage: 1 };
        const [inView, inPlace] = await Promise.all([
          searchListings({ ...probe, query: "*" }),
          searchListings({ ...probe, query: place }),
        ]);
        if (cancelled) return;
        const total = inView.totalFound;
        const count = Math.max(0, total - inPlace.totalFound);
        // Below the threshold the place filter is still answering the visible question,
        // so stay silent rather than badge a view that is mostly what the user asked for.
        setHidden(total > 0 && count / total >= HIDDEN_SHARE_THRESHOLD ? count : 0);
      } catch {
        // A probe failure must never surface a notice — silence is the safe default.
        if (!cancelled) setHidden(0);
      }
    }, PROBE_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, place, mapBounds, transactionMode, propertyClass, universalFilters, filters]);

  // While a new probe is in flight the previous count lingers for one debounce window.
  // That is deliberate: it settles in step with the listing results, so the notice never
  // flickers off and back on mid-pan.
  return active ? hidden : 0;
}
