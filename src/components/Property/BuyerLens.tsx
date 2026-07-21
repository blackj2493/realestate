"use client";

/**
 * BuyerLens — the homebuyer-facing view of the listing calculator (the default).
 *
 * Answers the two questions a buyer actually has — "what's the monthly payment?"
 * and "can I afford this?" — instead of the investor cap-rate/DSCR framing. Leads
 * with the true monthly cost, then income-to-qualify (stress-tested) and the
 * upfront cash-to-close (Ontario LTT + rebate + CMHC). A quiet, payoff-advertising
 * link escalates to the investor underwrite only when asked.
 *
 * Shared inputs (down/rate/amortization) are controlled by the parent shell so
 * they carry across the lens toggle. All math is pure + deterministic (§4).
 * Every colour is theme-aware — never hardcode a single-mode text colour.
 */

import React, { useMemo } from "react";
import { Wallet, Home, Percent, Info, TriangleAlert, ArrowRight } from "lucide-react";
import { cn, formatPrice } from "@/lib/utils";
import { Slider } from "@/components/ui/slider";
import { computeClosingCosts } from "@/lib/finance/closingCosts";
import { calculateCanadianMonthlyMortgage } from "@/lib/finance/canadianMortgage";
import { incomeToQualify } from "@/lib/finance/affordability";
import { UW_DEFAULTS } from "@/lib/underwriting/computeUnderwriting";
import type { SharedDealInputs } from "@/lib/finance/dealInputs";

function Row({
  label,
  sub,
  value,
  tone = "neutral",
  strong = false,
}: {
  label: string;
  sub?: string;
  value: string;
  tone?: "neutral" | "credit" | "muted";
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className={cn("text-xs", strong ? "font-semibold text-foreground" : "text-muted-foreground")}>
        {label}
        {sub && <span className="ml-1 text-[10px] text-muted-foreground/70">{sub}</span>}
      </span>
      <span
        className={cn(
          "font-mono tabular-nums whitespace-nowrap",
          strong ? "text-sm font-bold text-foreground" : "text-xs",
          tone === "credit" && "text-emerald-700 dark:text-emerald-400",
          tone === "muted" && "text-muted-foreground",
          tone === "neutral" && !strong && "text-foreground"
        )}
      >
        {value}
      </span>
    </div>
  );
}

export default function BuyerLens({
  listPrice,
  annualTaxes,
  monthlyFees,
  isToronto,
  isOntario,
  incomeApplicable = true,
  shared,
  onSharedChange,
  firstTimeBuyer,
  onFirstTimeBuyerChange,
  rateAsOf,
  onShowInvestor,
}: {
  listPrice: number;
  annualTaxes: number;
  monthlyFees: number;
  isToronto: boolean;
  isOntario: boolean;
  incomeApplicable?: boolean;
  shared: SharedDealInputs;
  onSharedChange: (next: SharedDealInputs) => void;
  firstTimeBuyer: boolean;
  onFirstTimeBuyerChange: (v: boolean) => void;
  rateAsOf: string | null;
  onShowInvestor: () => void;
}) {
  const set = <K extends keyof SharedDealInputs>(key: K, val: number) =>
    onSharedChange({ ...shared, [key]: val });

  const price = Math.max(0, listPrice);
  const insurance = UW_DEFAULTS.insuranceMonthly;

  const { closing, monthlyMortgage, monthlyPayment, qualify } = useMemo(() => {
    const downPayment = price * (shared.downPaymentPct / 100);
    const cl = computeClosingCosts({ price, downPayment, isToronto, firstTimeBuyer });
    const mort = calculateCanadianMonthlyMortgage(cl.totalMortgage, shared.interestRatePct / 100, shared.amortYears * 12);
    const q = incomeToQualify({
      loanAmount: cl.totalMortgage,
      contractRatePct: shared.interestRatePct,
      amortYears: shared.amortYears,
      annualPropertyTax: annualTaxes,
      monthlyCondoFees: monthlyFees,
    });
    return { closing: cl, monthlyMortgage: mort, monthlyPayment: mort + annualTaxes / 12 + monthlyFees + insurance, qualify: q };
  }, [price, shared, isToronto, firstTimeBuyer, annualTaxes, monthlyFees, insurance]);

  const asOfLabel = rateAsOf
    ? new Date(rateAsOf).toLocaleDateString("en-CA", { month: "short", year: "numeric" })
    : "current estimate";

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      {/* Header */}
      <div className="mb-4 flex items-center gap-2">
        <Wallet className="h-4 w-4 text-cyan-700 dark:text-cyan-400" />
        <span className="text-sm font-semibold uppercase tracking-wider text-foreground">Payment &amp; Costs</span>
      </div>

      {/* Hero: true monthly cost */}
      <div className="mb-4 rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs uppercase tracking-wider text-cyan-700 dark:text-cyan-400">Monthly payment</span>
          <span className="font-mono text-2xl font-bold tabular-nums text-foreground">{formatPrice(monthlyPayment)}</span>
        </div>
        <span className="text-[10px] text-muted-foreground">
          mortgage + property tax{monthlyFees > 0 ? " + condo fees" : ""} + insurance
        </span>
      </div>

      {/* Shared inputs — down payment */}
      <div className="mb-3">
        <div className="mb-1 flex items-center justify-between">
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Home className="h-3 w-3" /> Down Payment
          </span>
          <span className="font-mono text-xs text-cyan-700 dark:text-cyan-400">
            {shared.downPaymentPct}% · {formatPrice(closing.downPayment)}
          </span>
        </div>
        <Slider
          value={[shared.downPaymentPct]}
          onValueChange={([v]) => set("downPaymentPct", v)}
          min={5}
          max={50}
          step={1}
          ariaLabel="Down payment percent"
        />
        {closing.belowMinDown ? (
          <p className="mt-1.5 flex items-start gap-1 text-[10px] text-amber-700 dark:text-amber-400">
            <TriangleAlert className="mt-px h-3 w-3 shrink-0" />
            Below the {formatPrice(closing.minDownPayment)} minimum down payment for this price.
          </p>
        ) : (
          <p className="mt-1.5 text-[10px] text-muted-foreground">Minimum for this home: {formatPrice(closing.minDownPayment)}</p>
        )}
      </div>

      {/* Shared inputs — interest rate */}
      <div className="mb-3">
        <div className="mb-1 flex items-center justify-between">
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Percent className="h-3 w-3" /> Interest Rate
          </span>
          <span className="font-mono text-xs text-cyan-700 dark:text-cyan-400">{shared.interestRatePct.toFixed(2)}%</span>
        </div>
        <Slider
          value={[shared.interestRatePct]}
          onValueChange={([v]) => set("interestRatePct", v)}
          min={3}
          max={9}
          step={0.125}
          ariaLabel="Interest rate percent"
        />
        <p className="mt-1.5 text-[10px] text-muted-foreground">Typical 5-yr fixed, {asOfLabel} — adjust to your rate.</p>
      </div>

      {/* Shared inputs — amortization */}
      <div className="mb-4">
        <span className="mb-1 block text-xs text-muted-foreground">Amortization</span>
        <select
          value={shared.amortYears}
          onChange={(e) => set("amortYears", Number(e.target.value))}
          className="h-8 w-full rounded border border-border bg-muted px-2 text-xs text-foreground"
        >
          <option value={15}>15 years</option>
          <option value={20}>20 years</option>
          <option value={25}>25 years</option>
          <option value={30}>30 years</option>
        </select>
      </div>

      {/* Payment breakdown */}
      <div className="mb-4 border-t border-border">
        <Row label="Mortgage" value={`${formatPrice(monthlyMortgage)}/mo`} />
        <Row label="Property tax" value={`${formatPrice(annualTaxes / 12)}/mo`} />
        {monthlyFees > 0 && <Row label="Condo fees" value={`${formatPrice(monthlyFees)}/mo`} />}
        <Row label="Home insurance" sub="est." value={`${formatPrice(insurance)}/mo`} tone="muted" />
      </div>

      {/* Income needed to qualify (#2) */}
      <div className="mb-4 rounded-lg border border-border p-3">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Income needed to qualify</div>
        <div className="mt-0.5 font-mono text-lg font-bold tabular-nums text-foreground">
          {formatPrice(qualify.requiredAnnualIncome)}/yr
        </div>
        <div className="mt-0.5 text-[10px] text-muted-foreground">
          household · stress-tested at {qualify.qualifyingRatePct.toFixed(2)}% (GDS 39%)
        </div>
      </div>

      {/* Cash to close (Ontario) */}
      {isOntario && (
        <>
          <button
            type="button"
            role="switch"
            aria-checked={firstTimeBuyer}
            onClick={() => onFirstTimeBuyerChange(!firstTimeBuyer)}
            className="mb-2 flex w-full items-center justify-between gap-2 rounded border border-border bg-muted/40 px-2.5 py-2 text-left transition-colors hover:bg-muted/70"
          >
            <span className="text-xs text-foreground">First-time home buyer</span>
            <span
              className={cn(
                "relative h-4 w-7 shrink-0 rounded-full transition-colors",
                firstTimeBuyer ? "bg-emerald-600" : "bg-muted-foreground/30"
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 h-3 w-3 rounded-full bg-white transition-transform",
                  firstTimeBuyer ? "translate-x-3.5" : "translate-x-0.5"
                )}
              />
            </span>
          </button>

          <div className="border-t border-border">
            <Row label="Down payment" value={formatPrice(closing.downPayment)} />
            <Row label="Land transfer tax" sub="(Ontario)" value={formatPrice(closing.provincialLtt)} />
            {isToronto && <Row label="Municipal LTT" sub="(Toronto)" value={formatPrice(closing.municipalLtt)} />}
            {closing.firstTimeBuyerRebate > 0 && (
              <Row label="First-time buyer rebate" value={`− ${formatPrice(closing.firstTimeBuyerRebate)}`} tone="credit" />
            )}
            {closing.insured && closing.cmhcPremiumTax > 0 && (
              <Row label="PST on CMHC insurance" value={formatPrice(closing.cmhcPremiumTax)} />
            )}
            <Row label="Legal fees" sub="est." value={formatPrice(closing.legalFees)} tone="muted" />
            <Row label="Title insurance" sub="est." value={formatPrice(closing.titleInsurance)} tone="muted" />
            <Row label="Cash to close" value={formatPrice(closing.cashToClose)} strong />
          </div>

          {closing.insured && closing.cmhcPremium > 0 && (
            <p className="mt-3 flex items-start gap-1.5 rounded bg-muted/40 p-2 text-[10px] leading-relaxed text-muted-foreground">
              <Info className="mt-px h-3 w-3 shrink-0" />
              <span>
                With less than 20% down, CMHC insurance of{" "}
                <span className="font-mono text-foreground">{formatPrice(closing.cmhcPremium)}</span> is added to your
                mortgage (financed — only its {formatPrice(closing.cmhcPremiumTax)} tax is paid in cash).
              </span>
            </p>
          )}
        </>
      )}

      {/* Escalate to the investor underwrite — quiet, opt-in, payoff-advertising. */}
      <button
        type="button"
        onClick={onShowInvestor}
        className="mt-3 flex w-full items-center justify-between gap-2 border-t border-border pt-3 text-left text-cyan-700 transition-colors hover:text-cyan-800 dark:text-cyan-400 dark:hover:text-cyan-300"
      >
        <span className="text-xs font-semibold">
          {incomeApplicable ? "Investor view" : "Carrying-cost detail"}
          <span className="mt-0.5 block text-[10px] font-normal text-muted-foreground">
            {incomeApplicable ? "cashflow, cap rate & DSCR" : "loan, carry & annual cost"}
          </span>
        </span>
        <ArrowRight className="h-3.5 w-3.5 shrink-0" />
      </button>

      {/* Disclaimer */}
      <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">
        PureProperty estimates from your assumptions — not financial or legal advice. Land-transfer, rebate and CMHC
        figures use Ontario rates; legal &amp; title are typical starting points. Confirm with your lawyer and lender.
      </p>
    </div>
  );
}
