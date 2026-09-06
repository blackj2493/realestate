/**
 * AlertFilterPrompt — the one-click way to point EXISTING area emails at your filters.
 *
 * WHY IT EXISTS. `defaultAlertScopeForRegion` now reads the lens, so an area added while
 * filters are set starts on 'filtered'. That does nothing for the areas you already have.
 * They keep `alert_scope = 'all'` forever, and the only control that changes it is the
 * per-area bell's segmented pair — which lives inside a section the user has to expand,
 * one area at a time.
 *
 * WHY NOT JUST FLIP THEM SERVER-SIDE. Three reasons, and migration 095 states the first
 * one in its own comment:
 *   • Never retroactively enforce a filter the user did not choose as an alert rule. A
 *     lens is a way to READ the dashboard; it is not consent to stop delivering email.
 *   • The change is invisible. Fewer emails with no notice and no named cause reads as
 *     broken delivery, and the user has nothing to undo because nothing told them.
 *   • Someone genuinely wants every listing. A silent flip takes that away.
 * Same shape as the reconcile's refusal to un-mute a row (see areaAlertSync): the code may
 * keep the two tables in step, but it may not make the user's alert decisions for them.
 *
 * So: state the count, offer one click, and take "Not now" for an answer. The dismissal
 * clears whenever the lens changes (DashboardClient.updateLens), so a NEW set of filters
 * asks once more — and only once more.
 *
 * The email carries the same offer for people who never come back to the dashboard; see
 * filterNudgeHtml in src/lib/alerts/digest.ts.
 */

"use client";

import React, { useEffect, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { useBubblesStore } from "@/lib/bubbles/useBubbles";
import { hasActiveLensFilters, type MarketActivityLens } from "@/lib/dashboard/config";
import { formatRegionLabel } from "@/lib/regions/formatRegionLabel";

export default function AlertFilterPrompt({
  regions,
  lens,
  dismissed,
  onDismiss,
}: {
  /** The dashboard's areas. Only these are offered — a drawn or school bubble has its
   *  own lifecycle and its own bell, and is not what "your areas" means here. */
  regions: string[];
  /** The filters as they are NOW. Captured on click, then kept in step by the
   *  server-side reconcile on every later config save. */
  lens: MarketActivityLens;
  dismissed: boolean;
  onDismiss: () => void;
}) {
  const init = useBubblesStore((s) => s.init);
  const items = useBubblesStore((s) => s.items);
  const signedIn = useBubblesStore((s) => s.signedIn);
  const updateAlertFilters = useBubblesStore((s) => s.updateAlertFilters);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void init();
  }, [init]);

  // Nothing to offer until the user has actually narrowed something. A default lens
  // translates to no clause at all, so "apply your filters" would apply nothing and the
  // email would not change — an offer that lies. See hasActiveLensFilters.
  if (!signedIn || dismissed || !hasActiveLensFilters(lens)) return null;

  const wanted = new Set(regions);
  // A MUTED row sends nothing, so it is not "emailing every new listing" and must not be
  // counted — the sentence would be false and the fix pointless.
  const unfiltered = Object.values(items).filter(
    (b) =>
      b.area_type === "city" &&
      b.source.kind === "city" &&
      wanted.has(b.source.city) &&
      b.alerts_enabled !== false &&
      b.alert_scope !== "filtered"
  );
  if (unfiltered.length === 0) return null;

  const n = unfiltered.length;
  const names = unfiltered
    .map((b) => (b.source.kind === "city" ? formatRegionLabel(b.source.city) : b.name))
    .join(", ");

  const applyAll = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // Sequential, not Promise.all: each call is a PATCH that also rewrites the store,
      // and the API is the same route the bell uses. A handful of areas is not worth
      // racing, and a partial failure leaves the untouched rows correct.
      for (const b of unfiltered) await updateAlertFilters(b.id, { lens });
      onDismiss();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-label="Apply your filters to your area emails"
      className="border border-border border-l-2 border-l-amber-500 bg-card/40 p-3 dark:border-l-amber-400/70 dark:bg-slate-900/40"
    >
      <div className="flex items-center gap-1.5">
        <SlidersHorizontal className="h-3.5 w-3.5 shrink-0 text-amber-700 dark:text-amber-400" />
        <h2 className="terminal-font text-[10px] font-semibold uppercase tracking-wider text-foreground">
          Email scope
        </h2>
      </div>

      <p className="mt-2 text-[13px] leading-relaxed text-foreground">
        {n === 1 ? "1 of your areas emails" : `${n} of your areas email`} every new listing.
        Apply your filters so the nightly email carries only the homes that match.
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground" title={names}>
        {names}
      </p>

      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={applyAll}
          disabled={busy}
          className="terminal-font inline-flex min-h-[44px] items-center border border-cyan-600 bg-cyan-600 px-3 text-[11px] uppercase tracking-wider text-white transition-colors hover:bg-cyan-700 disabled:opacity-60 sm:min-h-[32px] dark:border-cyan-500/50 dark:bg-cyan-500/15 dark:text-cyan-200 dark:hover:bg-cyan-500/25"
        >
          {busy ? "Applying…" : n === 1 ? "Apply to 1 area" : `Apply to all ${n}`}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          disabled={busy}
          className="terminal-font inline-flex min-h-[44px] items-center border border-border px-3 text-[11px] uppercase tracking-wider text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:opacity-60 sm:min-h-[32px]"
        >
          Not now
        </button>
      </div>
    </section>
  );
}
