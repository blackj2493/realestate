"use client";

import { Percent, Home, GitCompareArrows } from "lucide-react";
import { cn } from "@/lib/utils";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import LensSelector from "./LensSelector";
import type { PersonaType } from "@/lib/personas/personaConfig";

export default function AssumptionsBar({
  downPaymentPct,
  interestRatePct,
  onDownPayment,
  onInterestRate,
  lens,
  onLens,
  diffOnly,
  onDiffToggle,
}: {
  downPaymentPct: number;
  interestRatePct: number;
  onDownPayment: (v: number) => void;
  onInterestRate: (v: number) => void;
  lens: PersonaType;
  onLens: (lens: PersonaType) => void;
  diffOnly: boolean;
  onDiffToggle: (v: boolean) => void;
}) {
  return (
    <div className="sticky top-0 z-20 mb-4 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-lg border border-slate-800 bg-slate-900/80 px-4 py-3 backdrop-blur">
      <div className="min-w-[160px] flex-1">
        <div className="mb-1 flex items-center justify-between">
          <Label className="flex items-center gap-1 text-xs text-slate-400">
            <Home className="h-3 w-3" /> Down Payment
          </Label>
          <span className="font-mono text-xs text-emerald-400">{downPaymentPct}%</span>
        </div>
        <Slider value={[downPaymentPct]} onValueChange={([v]) => onDownPayment(v)} min={5} max={50} step={1} />
      </div>

      <div className="min-w-[160px] flex-1">
        <div className="mb-1 flex items-center justify-between">
          <Label className="flex items-center gap-1 text-xs text-slate-400">
            <Percent className="h-3 w-3" /> Interest Rate
          </Label>
          <span className="font-mono text-xs text-emerald-400">{interestRatePct.toFixed(3)}%</span>
        </div>
        <Slider value={[interestRatePct]} onValueChange={([v]) => onInterestRate(v)} min={3} max={12} step={0.125} />
      </div>

      <div className="flex items-center gap-3">
        <LensSelector lens={lens} onChange={onLens} />
        <button
          type="button"
          onClick={() => onDiffToggle(!diffOnly)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
            diffOnly
              ? "border-cyan-400/50 bg-cyan-500/20 text-cyan-100"
              : "border-slate-700 text-slate-400 hover:text-slate-200"
          )}
          title="Hide rows where every property is identical"
        >
          <GitCompareArrows className="h-3.5 w-3.5" />
          Differences only
        </button>
      </div>

      <p className="w-full text-[10px] text-slate-600">
        Carry, cap rate &amp; cashflow recompute live from your assumptions — list-price math, not advice.
        Rent is a per-property estimate; adjust it in each column.
      </p>
    </div>
  );
}
