"use client";

/**
 * Cashflow at the reader's own financing — the three financing controls as one card.
 *
 * Down payment and rate filter nothing on their own (their buildClause is null). They set
 * the break-even cap rate that "Cashflow positive only" filters on, so the card states that
 * number and moves it the instant a slider moves; without it, a reader who drags the rate
 * sees the result count hold still and decides the control is broken. The switch carries a
 * live count ("214 homes clear it") so the reader sees the effect before turning it on.
 */

import React from "react";
import { Calculator } from "lucide-react";
import { cn } from "@/lib/utils";
import { Slider } from "@/components/ui/slider";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";
import { breakEvenCapRate } from "@/lib/metrics/liveCashflow";
import { CONTROL_BY_ID } from "@/lib/filters/filterPanelConfig";
import { LABEL, PANEL_SLIDER, Switch } from "./primitives";

function FinancingSlider({ id }: { id: "downPaymentPct" | "interestRatePct" }) {
  const value = useCommandCenterStore((s) => s.filters[id]);
  const setFilter = useCommandCenterStore((s) => s.setFilter);
  const c = CONTROL_BY_ID[id];
  if (!c || c.kind !== "slider") return null;
  const label = id === "downPaymentPct" ? "Your down payment" : "Your rate";
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className={cn(LABEL, "text-muted-foreground")}>{label}</span>
        <span className="font-mono text-xs font-semibold text-cyan-700 dark:text-cyan-400">{c.format(value)}</span>
      </div>
      <Slider
        value={[value]}
        min={c.min}
        max={c.max}
        step={c.step}
        ariaLabel={label}
        getAriaValueText={c.format}
        onValueChange={([v]) => setFilter(id, v)}
        {...PANEL_SLIDER}
      />
    </div>
  );
}

export default function CashflowCard({ count }: { count: number | undefined }) {
  const filters = useCommandCenterStore((s) => s.filters);
  const setFilter = useCommandCenterStore((s) => s.setFilter);
  const on = filters.cashflowPositiveOnly;
  const breakEven = breakEvenCapRate(filters);

  return (
    <section className="space-y-4 border border-border bg-card p-4" aria-label="Cashflow at your financing">
      <div className="flex items-center justify-between gap-2">
        <span className={cn(LABEL, "flex items-center gap-1.5 text-cyan-700 dark:text-cyan-400")}>
          <Calculator className="h-3.5 w-3.5" aria-hidden />
          Cashflow · at your financing
        </span>
        <span className="text-[10px] text-muted-foreground">assumptions</span>
      </div>

      <FinancingSlider id="downPaymentPct" />
      <FinancingSlider id="interestRatePct" />

      <p className="border-t border-border/60 pt-3 font-mono text-[11px] leading-snug text-foreground">
        {filters.downPaymentPct}% down · {filters.interestRatePct.toFixed(2)}% · {filters.amortYears}yr →{" "}
        <span className="font-semibold text-cyan-700 dark:text-cyan-300">{breakEven.toFixed(2)}% cap</span>{" "}
        <span className="text-muted-foreground">breaks even</span>
      </p>

      <div className="flex items-center justify-between gap-3 border border-border bg-muted/30 px-3 py-2.5">
        <span className="min-w-0">
          <span className="block text-sm font-medium text-foreground">Cashflow positive only</span>
          <span className="block font-mono text-[11px] text-muted-foreground">
            {count === undefined
              ? "Counting…"
              : on
                ? `Showing the ${count.toLocaleString("en-US")} that clear it`
                : `${count.toLocaleString("en-US")} ${count === 1 ? "home clears" : "homes clear"} it`}
          </span>
        </span>
        <Switch
          checked={on}
          onChange={(next) => setFilter("cashflowPositiveOnly", next)}
          label="Cashflow positive only"
        />
      </div>
    </section>
  );
}
