"use client";

/**
 * ListingCalculator — the unified right-rail calculator shell.
 *
 * One tool, two lenses over a SHARED set of mortgage inputs (down payment, rate,
 * amortization), so setting them once carries across the toggle:
 *   • Buyer lens (default for the Homebuyer persona) — monthly payment, income to
 *     qualify, and cash to close.
 *   • Investor lens (default for the cashflow/flipper/builder personas) — the
 *     existing UnderwritingSandbox underwrite, opened via a quiet link.
 *
 * The rate seed comes from the live Bank-of-Canada-refreshed value (getMortgageRate).
 * Non-income properties (vacant land, commercial) skip the split and show the
 * carry-only sandbox exactly as before — no behaviour change there.
 */

import React, { useState } from "react";
import { ArrowLeft } from "lucide-react";
import UnderwritingSandbox from "./UnderwritingSandbox";
import BuyerLens from "./BuyerLens";
import { DEFAULT_DOWN_PCT, DEFAULT_AMORT_YEARS, type SharedDealInputs } from "@/lib/finance/dealInputs";

export type CalculatorLens = "buyer" | "investor";

export default function ListingCalculator({
  listingId,
  listPrice,
  annualTaxes,
  monthlyFees,
  hasSuitePotential = false,
  incomeApplicable = true,
  isToronto,
  isOntario,
  initialRatePct,
  rateAsOf,
  defaultLens,
  className,
}: {
  listingId: string;
  listPrice: number;
  annualTaxes: number;
  monthlyFees: number;
  hasSuitePotential?: boolean;
  incomeApplicable?: boolean;
  isToronto: boolean;
  isOntario: boolean;
  initialRatePct: number;
  rateAsOf: string | null;
  defaultLens: CalculatorLens;
  className?: string;
}) {
  const [shared, setShared] = useState<SharedDealInputs>({
    downPaymentPct: DEFAULT_DOWN_PCT,
    interestRatePct: initialRatePct,
    amortYears: DEFAULT_AMORT_YEARS,
  });
  const [lens, setLens] = useState<CalculatorLens>(defaultLens);
  const [firstTimeBuyer, setFirstTimeBuyer] = useState(false);

  // Non-income properties (land/commercial) skip the buyer split — carry-only
  // sandbox, identical to the prior behaviour.
  if (!incomeApplicable) {
    return (
      <UnderwritingSandbox
        listingId={listingId}
        listPrice={listPrice}
        annualTaxes={annualTaxes}
        monthlyFees={monthlyFees}
        hasSuitePotential={hasSuitePotential}
        incomeApplicable={false}
        className={className}
      />
    );
  }

  return (
    <div data-tour="listing-calculator" className={className}>
      {lens === "buyer" ? (
        <BuyerLens
          listPrice={listPrice}
          annualTaxes={annualTaxes}
          monthlyFees={monthlyFees}
          isToronto={isToronto}
          isOntario={isOntario}
          incomeApplicable={incomeApplicable}
          shared={shared}
          onSharedChange={setShared}
          firstTimeBuyer={firstTimeBuyer}
          onFirstTimeBuyerChange={setFirstTimeBuyer}
          rateAsOf={rateAsOf}
          onShowInvestor={() => setLens("investor")}
        />
      ) : (
        <>
          <button
            type="button"
            onClick={() => setLens("buyer")}
            className="mb-2 flex items-center gap-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" /> Payment &amp; cash to close
          </button>
          <UnderwritingSandbox
            listingId={listingId}
            listPrice={listPrice}
            annualTaxes={annualTaxes}
            monthlyFees={monthlyFees}
            hasSuitePotential={hasSuitePotential}
            incomeApplicable={incomeApplicable}
            controlledShared={shared}
            onSharedChange={setShared}
          />
        </>
      )}
    </div>
  );
}
