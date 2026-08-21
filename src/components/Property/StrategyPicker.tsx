"use client";

/**
 * StrategyPicker — how the reader intends to run the property.
 *
 * Two positions at a time, never three. A home either HAS an in-home suite or it does
 * not, and the choice that matters differs:
 *
 *   suite observed   [ Split ]* [ Whole home ]      is the basement leased separately?
 *   no suite         [ Whole home ]* [ Add a suite ]  what would building one earn?
 *
 * The split is the default wherever a suite exists, because that is what the property
 * is — the reader is in the investor lens by definition, and a second kitchen was
 * built for a reason. "Add a suite" is never a default: it costs $50k-$120k and a
 * permit, so opening on it would publish a return on capital nobody has spent.
 *
 * This replaced a hidden $1,500/mo "Other / Suite Income" slider behind an Advanced
 * disclosure, switched on automatically by KitchensBelowGrade. That constant was 21%
 * off the local median and more than 25% off on 143 of 331 city cohorts.
 */

import React from "react";
import { cn } from "@/lib/utils";
import type { UnderwritingStrategy } from "@/lib/underwriting/computeUnderwriting";

export interface StrategyOption {
  id: UnderwritingStrategy;
  label: string;
  hint: string;
}

/**
 * Which two positions this listing gets, or none.
 *
 * Extracted from the sandbox so it can be tested: it is the rule that decides what the
 * reader is even offered, and it was previously a nested ternary inside a 500-line
 * component where nothing could reach it.
 *
 * Both suite paths demand a RENT and its counterpart together:
 *   Split      needs an OBSERVED suite rent — a suite that exists on this property.
 *   Add a suite needs an AREA suite rent AND a build cost. A cost with no rent beside
 *              it is not a scenario, it is a bill; that is exactly how it renders for
 *              an anon reader, whose rent figures are VOW-gated.
 */
export function strategyOptionsFor(input: {
  suiteMonthlyRent?: number | null;
  areaSuiteMonthlyRent?: number | null;
  suiteConversion?: { low: number; high: number } | null;
  formatMoney: (n: number) => string;
}): StrategyOption[] {
  const { suiteMonthlyRent, areaSuiteMonthlyRent, suiteConversion, formatMoney } = input;
  if (suiteMonthlyRent) {
    return [
      { id: "split", label: "Split", hint: "Main unit and the in-home suite leased separately, both from local comps" },
      { id: "whole-home", label: "Whole home", hint: "One tenant, the entire house — no separate suite income" },
    ];
  }
  if (suiteConversion && areaSuiteMonthlyRent) {
    return [
      { id: "whole-home", label: "Whole home", hint: "One tenant, the entire house" },
      {
        id: "add-suite",
        label: "Add a suite",
        hint: `What a legal basement suite would earn, against ${formatMoney(suiteConversion.low)}–${formatMoney(suiteConversion.high)} to build it`,
      },
    ];
  }
  return [];
}

export default function StrategyPicker({
  options,
  value,
  onChange,
  className,
}: {
  options: StrategyOption[];
  value: UnderwritingStrategy;
  onChange: (s: UnderwritingStrategy) => void;
  className?: string;
}) {
  if (options.length < 2) return null;
  return (
    <div
      role="radiogroup"
      aria-label="Rental strategy"
      className={cn(
        "grid gap-1 rounded-lg border border-border bg-muted/40 p-1",
        options.length === 2 ? "grid-cols-2" : "grid-cols-3",
        className
      )}
    >
      {options.map((o) => {
        const on = value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.id)}
            title={o.hint}
            className={cn(
              "rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
              on ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
