"use client";

import React from "react";
import { Calculator } from "lucide-react";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";
import { breakEvenCapRate } from "@/lib/metrics/liveCashflow";
import type { ControlDef } from "@/lib/personas/personaConfig";
import InvestorChip from "./InvestorChip";

/**
 * The financing controls, boxed together and explained.
 *
 * "Cashflow +ve", "Down Pmt" and "My Rate" sat in the flat "More investor signals" row,
 * looking like three unrelated filters. They are one mechanism: the two sliders are
 * assumptions that DEFINE the toggle. Both slider `buildClause` return null, so a reader
 * who drags the rate and sees the result count hold still concludes the control is broken,
 * and a reader who never touches them gets a "positive" list computed at someone else's
 * mortgage — at 20% down the break-even cap rate is 5.85% at 5.5%/25yr against 4.59% at
 * the ETL's stored 4.04%/30yr, and the sign flips on thousands of listings between them.
 *
 * So the group states the derived number. The break-even cap rate is the whole
 * relationship in one line, and it moves the instant either slider moves — which is the
 * feedback the sliders could not give on their own.
 */
export default function FinancingGroup({ controls }: { controls: ControlDef[] }) {
  const filters = useCommandCenterStore((s) => s.filters);
  if (controls.length === 0) return null;

  const breakEven = breakEvenCapRate(filters);
  const on = filters.cashflowPositiveOnly;

  return (
    <section className="space-y-2 border-t border-border/70 pt-4">
      <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        <Calculator className="h-3 w-3" />
        Cashflow · at your financing
      </span>

      <div className="space-y-2.5 border border-border bg-muted/30 p-2.5">
        <p className="text-[11px] leading-snug text-muted-foreground">
          Your down payment and rate are <span className="font-medium text-foreground">assumptions</span>,
          not filters. They set what counts as cashflow positive, and drive the cashflow column
          in the ledger.
        </p>

        <div className="flex flex-wrap gap-2">
          {controls.map((c) => (
            <InvestorChip key={c.kind === "range" ? c.minKey : c.key} control={c} />
          ))}
        </div>

        {/* The derived number — the reason the three belong together. */}
        <p className="border-t border-border/60 pt-2 font-mono text-[11px] leading-snug text-foreground">
          {filters.downPaymentPct}% down · {filters.interestRatePct.toFixed(2)}% ·{" "}
          {filters.amortYears}yr →{" "}
          <span className="font-semibold text-cyan-700 dark:text-cyan-300">
            {breakEven.toFixed(2)}% cap
          </span>{" "}
          <span className="text-muted-foreground">breaks even</span>
        </p>
        <p className="text-[10px] leading-snug text-muted-foreground">
          {on
            ? "Showing listings at or above that cap rate."
            : "Turn on Cashflow +ve to filter on it."}
        </p>
      </div>
    </section>
  );
}
