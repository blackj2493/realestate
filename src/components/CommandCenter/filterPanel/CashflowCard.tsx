"use client";

/**
 * Cashflow at the reader's own financing — the three financing controls as one card.
 *
 * Down payment and rate filter nothing on their own (their buildClause is null). They set
 * the break-even cap rate that "Cashflow positive only" filters on, so the card states that
 * number and moves it the instant a slider moves; without it, a reader who drags the rate
 * sees the result count hold still and decides the control is broken. The switch carries a
 * live count ("214 homes clear it") so the reader sees the effect before turning it on.
 *
 * It is the panel's one dark "instrument" card in both themes, with its own colours.
 */

import React from "react";
import { Calculator } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";
import { breakEvenCapRate } from "@/lib/metrics/liveCashflow";
import { CONTROL_BY_ID } from "@/lib/filters/filterPanelConfig";
import { Switch } from "./primitives";

const SLIDER = {
  trackClassName: "h-1.5 rounded-full bg-white/15",
  rangeClassName: "rounded-full bg-gradient-to-r from-cyan-400 to-teal-300",
  thumbClassName: "h-6 w-6 rounded-full border-2 border-cyan-300 bg-white shadow-md",
} as const;

function FinancingSlider({ id }: { id: "downPaymentPct" | "interestRatePct" }) {
  const value = useCommandCenterStore((s) => s.filters[id]);
  const setFilter = useCommandCenterStore((s) => s.setFilter);
  const c = CONTROL_BY_ID[id];
  if (!c || c.kind !== "slider") return null;
  const label = id === "downPaymentPct" ? "Down payment" : "Your rate";
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between text-sm text-slate-300">
        <span>{label}</span>
        <span className="font-mono text-sm font-bold text-white">{c.format(value)}</span>
      </div>
      <Slider
        value={[value]}
        min={c.min}
        max={c.max}
        step={c.step}
        ariaLabel={label}
        getAriaValueText={c.format}
        onValueChange={([v]) => setFilter(id, v)}
        {...SLIDER}
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
    <div className="space-y-4 rounded-2xl bg-gradient-to-br from-slate-900 to-[#12304a] p-4 text-white shadow-[0_8px_24px_-12px_rgba(15,23,42,0.6)] ring-1 ring-white/5">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-cyan-300">
          <Calculator className="h-3.5 w-3.5" aria-hidden />
          Cashflow at your financing
        </span>
        <span className="text-[11px] text-slate-400">assumptions</span>
      </div>

      <FinancingSlider id="downPaymentPct" />
      <FinancingSlider id="interestRatePct" />

      <p className="border-t border-white/10 pt-3 font-mono text-xs leading-relaxed text-slate-300">
        {filters.downPaymentPct}% down · {filters.interestRatePct.toFixed(2)}% · {filters.amortYears}yr →{" "}
        <span className="font-bold text-teal-300">{breakEven.toFixed(2)}% cap</span> breaks even
      </p>

      <div className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.07] px-3 py-2.5">
        <span className="min-w-0">
          <span className="block text-sm font-semibold">Cashflow positive only</span>
          <span className="block font-mono text-[11px] text-slate-400">
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
    </div>
  );
}
