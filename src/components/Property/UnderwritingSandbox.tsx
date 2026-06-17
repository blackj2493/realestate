"use client";

/**
 * UnderwritingSandbox (P6) — the saveable what-if underwrite that replaces the old
 * CarryCostCalculator in the right rail.
 *
 * It models the full buy-and-hold deal (income + cost side): the user tunes down
 * payment, rate, amortization, rent, vacancy, and opex and sees monthly cashflow,
 * cap rate, cash-on-cash, carry, NOI, and DSCR recompute live. Scenarios can be
 * named and saved — synced server-side when signed in, localStorage when not.
 *
 * Compliance (CLAUDE.md §4): every number comes from `computeUnderwriting`, a pure
 * deterministic engine. No listing text is ever sent to an LLM.
 */

import React, { useEffect, useMemo, useState } from "react";
import {
  Calculator,
  Percent,
  Home,
  TrendingDown,
  ChevronDown,
  Save,
  Trash2,
  FolderOpen,
} from "lucide-react";
import { cn, formatPrice } from "@/lib/utils";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  computeUnderwriting,
  seedAssumptions,
  type UnderwritingAssumptions,
} from "@/lib/underwriting/computeUnderwriting";
import { useScenariosStore, type Scenario } from "@/lib/underwriting/useScenarios";

const EMPTY: Scenario[] = [];

interface UnderwritingSandboxProps {
  listingId: string;
  listPrice: number;
  annualTaxes: number;
  monthlyFees: number;
  hasSuitePotential?: boolean;
  /**
   * Whether rental-income metrics apply to this property. False for non-income
   * parcels (e.g. vacant land), where rent → cap rate / yield / cashflow would
   * be a fabrication; the sandbox then shows carrying cost only. (Audit C2.)
   */
  incomeApplicable?: boolean;
  className?: string;
}

function pct(n: number): string {
  return `${n.toFixed(2)}%`;
}

function Metric({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "good" | "bad";
}) {
  return (
    <div className="bg-slate-800/50 rounded p-2">
      <span className="text-[10px] text-slate-500 uppercase tracking-wider">{label}</span>
      <p
        className={cn(
          "text-sm font-bold font-mono",
          tone === "good" && "text-emerald-400",
          tone === "bad" && "text-rose-400",
          tone === "neutral" && "text-slate-200"
        )}
      >
        {value}
      </p>
    </div>
  );
}

export default function UnderwritingSandbox({
  listingId,
  listPrice,
  annualTaxes,
  monthlyFees,
  hasSuitePotential = false,
  incomeApplicable = true,
  className,
}: UnderwritingSandboxProps) {
  const [a, setA] = useState<UnderwritingAssumptions>(() =>
    seedAssumptions({ listPrice, annualTaxes, monthlyFees, hasSuitePotential })
  );
  const [advanced, setAdvanced] = useState(false);
  const [scenarioName, setScenarioName] = useState("");
  const [savedFlash, setSavedFlash] = useState(false);

  const set = <K extends keyof UnderwritingAssumptions>(key: K, val: UnderwritingAssumptions[K]) =>
    setA((prev) => ({ ...prev, [key]: val }));

  const result = useMemo(() => computeUnderwriting(a), [a]);

  // ── Saved scenarios (dual-path store) ──────────────────────────────────────
  const signedIn = useScenariosStore((s) => s.signedIn);
  const scenarios = useScenariosStore((s) => s.byListing[listingId]) ?? EMPTY;
  const loadScenarios = useScenariosStore((s) => s.load);
  const saveScenario = useScenariosStore((s) => s.save);
  const removeScenario = useScenariosStore((s) => s.remove);

  useEffect(() => {
    loadScenarios(listingId);
  }, [listingId, loadScenarios]);

  const handleSave = async () => {
    const name = scenarioName.trim() || `${a.downPaymentPct}% down @ ${a.interestRatePct}%`;
    const saved = await saveScenario(listingId, name, a);
    if (saved) {
      setScenarioName("");
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);
    }
  };

  const cashflowTone = result.monthlyCashflow >= 0 ? "good" : "bad";

  return (
    <div className={cn("bg-slate-900/50 rounded-lg border border-slate-800 p-4", className)}>
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <Calculator className="h-4 w-4 text-emerald-400" />
        <span className="text-sm font-semibold text-slate-200 uppercase tracking-wider">
          Underwriting Sandbox
        </span>
      </div>

      {incomeApplicable ? (
        <>
          {/* Hero: monthly cashflow */}
          <div
            className={cn(
              "rounded-lg p-3 mb-4 border",
              cashflowTone === "good"
                ? "bg-emerald-900/20 border-emerald-800/50"
                : "bg-rose-900/20 border-rose-800/50"
            )}
          >
            <div className="flex items-center justify-between">
              <span
                className={cn(
                  "text-xs uppercase tracking-wider",
                  cashflowTone === "good" ? "text-emerald-400" : "text-rose-400"
                )}
              >
                Monthly Cashflow
              </span>
              <span
                className={cn(
                  "text-2xl font-bold font-mono",
                  cashflowTone === "good" ? "text-emerald-400" : "text-rose-400"
                )}
              >
                {result.monthlyCashflow >= 0 ? "+" : "−"}
                {formatPrice(Math.abs(result.monthlyCashflow))}
              </span>
            </div>
            <span className="text-[10px] text-slate-500">
              /mo after mortgage, taxes, fees, insurance & opex
            </span>
          </div>

          {/* Key metrics */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            <Metric label="Cap Rate" value={pct(result.capRatePct)} />
            <Metric
              label="Cash-on-Cash"
              value={pct(result.cashOnCashPct)}
              tone={result.cashOnCashPct >= 0 ? "good" : "bad"}
            />
            <Metric label="Monthly Carry" value={`${formatPrice(result.monthlyCarry)}/mo`} />
            <Metric label="Monthly NOI" value={`${formatPrice(result.monthlyNOI)}/mo`} />
            <Metric label="Gross Yield (rent)" value={pct(result.grossYieldPct)} />
            <Metric label="DSCR" value={result.dscr === null ? "—" : result.dscr.toFixed(2)} />
          </div>
        </>
      ) : (
        <>
          {/* Hero: monthly carrying cost (no rental income on this property type) */}
          <div className="rounded-lg p-3 mb-4 border bg-slate-800/40 border-slate-700">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-wider text-slate-300">
                Monthly Carry
              </span>
              <span className="text-2xl font-bold font-mono text-slate-100">
                {formatPrice(result.monthlyCarry)}
              </span>
            </div>
            <span className="text-[10px] text-slate-500">
              /mo out of pocket — mortgage, taxes, fees & insurance
            </span>
          </div>

          <p className="mb-4 text-[11px] leading-relaxed text-amber-400/80">
            No rental income applies to this property type (e.g. vacant land), so
            cap rate, yield and cashflow are not shown — they&apos;d be fabricated.
            Carrying cost only.
          </p>

          {/* Cost-side metrics */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            <Metric label="Down Payment" value={formatPrice(result.downPayment)} />
            <Metric label="Loan Amount" value={formatPrice(result.loanAmount)} />
            <Metric label="Monthly Mortgage" value={`${formatPrice(result.monthlyMortgage)}/mo`} />
            <Metric label="Annual Carry" value={`${formatPrice(result.monthlyCarry * 12)}/yr`} />
          </div>
        </>
      )}

      {/* Down payment */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-1">
          <Label className="text-xs text-slate-400 flex items-center gap-1">
            <Home className="h-3 w-3" /> Down Payment
          </Label>
          <span className="text-xs font-mono text-emerald-400">
            {a.downPaymentPct}% · {formatPrice(result.downPayment)}
          </span>
        </div>
        <Slider
          value={[a.downPaymentPct]}
          onValueChange={([v]) => set("downPaymentPct", v)}
          min={5}
          max={50}
          step={1}
        />
      </div>

      {/* Interest rate */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-1">
          <Label className="text-xs text-slate-400 flex items-center gap-1">
            <Percent className="h-3 w-3" /> Interest Rate
          </Label>
          <span className="text-xs font-mono text-emerald-400">{a.interestRatePct.toFixed(3)}%</span>
        </div>
        <Slider
          value={[a.interestRatePct]}
          onValueChange={([v]) => set("interestRatePct", v)}
          min={3}
          max={12}
          step={0.125}
        />
      </div>

      {/* Amortization */}
      <div className="mb-4">
        <Label className="text-xs text-slate-400 mb-1 block">Amortization</Label>
        <select
          value={a.amortYears}
          onChange={(e) => set("amortYears", Number(e.target.value))}
          className="w-full h-8 bg-slate-800 border border-slate-700 rounded text-xs text-slate-200 px-2"
        >
          <option value={15}>15 years</option>
          <option value={20}>20 years</option>
          <option value={25}>25 years</option>
          <option value={30}>30 years</option>
        </select>
      </div>

      {incomeApplicable && (
        <>
          {/* Monthly rent */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-1">
              <Label className="text-xs text-slate-400">Monthly Rent</Label>
              <span className="text-[10px] text-amber-400/80">estimate — adjust</span>
            </div>
            <Input
              type="number"
              inputMode="numeric"
              value={a.monthlyRent}
              onChange={(e) => set("monthlyRent", Math.max(0, Number(e.target.value)))}
              className="h-8 bg-slate-800 border-slate-700 text-xs font-mono text-slate-200"
            />
          </div>

          {/* Vacancy */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-1">
              <Label className="text-xs text-slate-400">Vacancy</Label>
              <span className="text-xs font-mono text-slate-300">{a.vacancyPct.toFixed(1)}%</span>
            </div>
            <Slider
              value={[a.vacancyPct]}
              onValueChange={([v]) => set("vacancyPct", v)}
              min={0}
              max={15}
              step={0.5}
            />
          </div>

          {/* Opex */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-1">
              <Label className="text-xs text-slate-400">Operating Expenses</Label>
              <span className="text-xs font-mono text-slate-300">{a.opexPct.toFixed(0)}%</span>
            </div>
            <Slider
              value={[a.opexPct]}
              onValueChange={([v]) => set("opexPct", v)}
              min={0}
              max={30}
              step={1}
            />
            <span className="text-[10px] text-slate-600">mgmt + maintenance + reserves, on gross income</span>
          </div>
        </>
      )}

      {/* Advanced */}
      <button
        type="button"
        onClick={() => setAdvanced((v) => !v)}
        className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-300 transition-colors mb-2"
      >
        <ChevronDown className={cn("h-3 w-3 transition-transform", advanced && "rotate-180")} />
        Advanced
      </button>
      {advanced && (
        <div className="space-y-4 mb-2 border-l border-slate-800 pl-3">
          <div>
            <div className="flex items-center justify-between mb-1">
              <Label className="text-xs text-slate-400 flex items-center gap-1">
                <TrendingDown className="h-3 w-3 text-blue-400" /> Other / Suite Income
              </Label>
              <span className="text-xs font-mono text-blue-400">
                {formatPrice(a.otherMonthlyIncome)}/mo
              </span>
            </div>
            <Slider
              value={[a.otherMonthlyIncome]}
              onValueChange={([v]) => set("otherMonthlyIncome", v)}
              min={0}
              max={4000}
              step={50}
            />
          </div>
          <div>
            <Label className="text-xs text-slate-400 mb-1 block">Insurance ($/mo)</Label>
            <Input
              type="number"
              inputMode="numeric"
              value={a.insuranceMonthly}
              onChange={(e) => set("insuranceMonthly", Math.max(0, Number(e.target.value)))}
              className="h-8 bg-slate-800 border-slate-700 text-xs font-mono text-slate-200"
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <Label className="text-xs text-slate-400">Closing Costs</Label>
              <span className="text-xs font-mono text-slate-300">{a.closingCostPct.toFixed(2)}%</span>
            </div>
            <Slider
              value={[a.closingCostPct]}
              onValueChange={([v]) => set("closingCostPct", v)}
              min={0}
              max={5}
              step={0.25}
            />
          </div>
        </div>
      )}

      {/* Save scenario */}
      <div className="border-t border-slate-800 pt-3 mt-3">
        <div className="flex items-center gap-2">
          <Input
            value={scenarioName}
            onChange={(e) => setScenarioName(e.target.value)}
            placeholder="Name this scenario…"
            maxLength={120}
            className="h-8 bg-slate-800 border-slate-700 text-xs text-slate-200"
          />
          <button
            type="button"
            onClick={handleSave}
            className={cn(
              "flex items-center gap-1 h-8 min-h-[44px] px-3 rounded text-xs font-semibold whitespace-nowrap transition-colors md:min-h-0",
              savedFlash
                ? "bg-emerald-600 text-white"
                : "bg-emerald-900/40 border border-emerald-800/60 text-emerald-300 hover:bg-emerald-900/60"
            )}
          >
            <Save className="h-3 w-3" />
            {savedFlash ? "Saved" : "Save"}
          </button>
        </div>
        {!signedIn && (
          <p className="text-[10px] text-slate-600 mt-1.5">
            Saved on this device · sign in to sync across devices
          </p>
        )}
      </div>

      {/* Saved scenarios list */}
      {scenarios.length > 0 && (
        <div className="mt-3 space-y-1.5">
          <div className="flex items-center gap-1.5 text-[10px] text-slate-500 uppercase tracking-wider">
            <FolderOpen className="h-3 w-3" /> Saved Scenarios
          </div>
          {scenarios.map((s) => {
            const r = computeUnderwriting(s.assumptions);
            return (
              <div
                key={s.id}
                className="flex items-center justify-between gap-2 bg-slate-800/40 rounded px-2 py-1.5"
              >
                <button
                  type="button"
                  onClick={() => setA(s.assumptions)}
                  className="flex-1 min-w-0 text-left group"
                  title="Load this scenario"
                >
                  <span className="block truncate text-xs text-slate-200 group-hover:text-emerald-300">
                    {s.name}
                  </span>
                  <span
                    className={cn(
                      "text-[10px] font-mono",
                      r.monthlyCashflow >= 0 ? "text-emerald-400/80" : "text-rose-400/80"
                    )}
                  >
                    {r.monthlyCashflow >= 0 ? "+" : "−"}
                    {formatPrice(Math.abs(r.monthlyCashflow))}/mo · {pct(r.capRatePct)} cap
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => removeScenario(listingId, s.id)}
                  className="text-slate-600 hover:text-rose-400 transition-colors shrink-0"
                  title="Delete scenario"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Disclaimer */}
      <p className="text-[10px] text-slate-600 mt-3 leading-relaxed">
        Based on your assumptions and estimates, not financial advice. Rent and operating
        figures are starting points — adjust to your underwriting.
      </p>
    </div>
  );
}
