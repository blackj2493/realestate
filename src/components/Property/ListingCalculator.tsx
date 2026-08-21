"use client";

/**
 * ListingCalculator — the unified right-rail calculator shell.
 *
 * One tool, two lenses over a SHARED set of mortgage inputs (down payment, rate,
 * amortization), so setting them once carries across the toggle:
 *   • Buyer lens (default for the Homebuyer persona) — monthly payment, income to
 *     qualify, and cash to close.
 *   • Investor lens (default for the cashflow/flipper/builder personas) — the
 *     UnderwritingSandbox underwrite: cashflow, cap rate, gross yield, DSCR.
 *
 * A persistent two-position toggle sits above both, so neither lens is more than one
 * tap away and the reader can see that the other one exists. It also FOLLOWS the page
 * persona lens (onLensChanged), one-way: persona → calculator. Not the reverse — the
 * persona has four values and this toggle has two, so "Investor" cannot say which
 * persona a reader meant, and guessing would move a score they did not ask to change.
 *
 * The rate seed comes from the live Bank-of-Canada-refreshed value (getMortgageRate).
 * Non-income properties (vacant land, commercial) skip the split and show the
 * carry-only sandbox exactly as before — no behaviour change there.
 */

import React, { useEffect, useState } from "react";
import { onLensChanged } from "@/lib/personas/lensPersistence";
import UnderwritingSandbox from "./UnderwritingSandbox";
import BuyerLens from "./BuyerLens";
import { DEFAULT_DOWN_PCT, DEFAULT_AMORT_YEARS, type SharedDealInputs } from "@/lib/finance/dealInputs";
import { cn } from "@/lib/utils";
import type { SuiteConversion } from "@/lib/listings/suiteConversion";

export type CalculatorLens = "buyer" | "investor";

/** The toggle's two positions. `hint` becomes the tooltip — a two-word tab cannot say
 *  what is behind it, and "Investor" alone does not tell a browsing homebuyer that this
 *  is where cap rate, cashflow and DSCR live. */
const LENS_TABS: Array<{ id: CalculatorLens; label: string; hint: string }> = [
  { id: "buyer", label: "Buyer", hint: "Monthly payment, cash to close, income to qualify" },
  { id: "investor", label: "Investor", hint: "Cashflow, cap rate, gross yield & DSCR" },
];

export default function ListingCalculator({
  listingId,
  listPrice,
  annualTaxes,
  monthlyFees,
  hasSuitePotential = false,
  compMonthlyRent = null,
  rentMatchTier = null,
  suiteMonthlyRent = null,
  areaSuiteMonthlyRent = null,
  suiteConversion = null,
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
  /** Comp-derived rent + its rung, threaded to the sandbox's Monthly Rent seed. */
  compMonthlyRent?: number | null;
  rentMatchTier?: string | null;
  /** Measured in-home suite rent (125), and the cost of building one where none exists. */
  suiteMonthlyRent?: number | null;
  areaSuiteMonthlyRent?: number | null;
  suiteConversion?: SuiteConversion | null;
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

  // Follow the page lens. `defaultLens` only seeds the FIRST render (the server resolves
  // it from ?lens= / the cookie), so without this the calculator sat where it was born
  // while every other picker moved. A reader who tapped "Cashflow A" on the Deal Score
  // got the score they asked for and a buyer calculator underneath it — the cap rate
  // behind that grade was two unrelated controls away. persistLens already broadcasts on
  // every chip click; three other components were listening and this one was not.
  //
  // Only the buyer/investor split is meaningful here, so every investor persona maps to
  // the underwrite and the homebuyer maps back to the buyer view. Non-income parcels
  // return before this matters — they have no split to switch.
  useEffect(
    () => onLensChanged((p) => setLens(incomeApplicable && p !== "smart" ? "investor" : "buyer")),
    [incomeApplicable]
  );

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
        compMonthlyRent={compMonthlyRent}
        rentMatchTier={rentMatchTier}
        suiteMonthlyRent={suiteMonthlyRent}
        areaSuiteMonthlyRent={areaSuiteMonthlyRent}
        suiteConversion={suiteConversion}
        incomeApplicable={false}
        className={className}
      />
    );
  }

  return (
    <div data-tour="listing-calculator" className={className}>
      {/* Both lenses are always one tap away.
          Before this, the two directions were different controls in different places:
          into the underwrite via a link at the BOTTOM of the buyer card, below every
          slider, so you scrolled the whole calculator to find it — and back out via a
          small "← Payment & cash to close" line above the sandbox. A reader who did not
          scroll never learned the investor view existed.
          radiogroup rather than ARIA tabs: the panels below are whole components with no
          tabpanel semantics, and this matches the Deal Score lens switcher the same page
          already ships. */}
      <div
        role="radiogroup"
        aria-label="Calculator view"
        className="mb-2 grid grid-cols-2 gap-1 rounded-lg border border-border bg-muted/40 p-1"
      >
        {LENS_TABS.map((t) => {
          const on = lens === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setLens(t.id)}
              title={t.hint}
              className={cn(
                "rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                on
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t.label}
            </button>
          );
        })}
      </div>

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
          // Kept as a second route: on a long card the reader who has just finished the
          // buyer numbers is at the bottom, and it names what they get ("cashflow, cap
          // rate & DSCR") in a way a two-word tab cannot.
          onShowInvestor={() => setLens("investor")}
        />
      ) : (
        <UnderwritingSandbox
          listingId={listingId}
          listPrice={listPrice}
          annualTaxes={annualTaxes}
          monthlyFees={monthlyFees}
          hasSuitePotential={hasSuitePotential}
          compMonthlyRent={compMonthlyRent}
          rentMatchTier={rentMatchTier}
          suiteMonthlyRent={suiteMonthlyRent}
          areaSuiteMonthlyRent={areaSuiteMonthlyRent}
          suiteConversion={suiteConversion}
          incomeApplicable={incomeApplicable}
          controlledShared={shared}
          onSharedChange={setShared}
        />
      )}
    </div>
  );
}
