"use client";

/**
 * Shared "your assumptions" state for Compare. Global down-payment % + interest
 * rate apply to ALL columns; rent is seeded per property via the same engine seed
 * the listing-page Sandbox uses (transparent, editable), with an optional override.
 * Every column re-underwrites through the deterministic computeUnderwriting engine.
 */
import { useMemo, useState, useCallback } from "react";
import type { ListingDocument } from "@/lib/typesense/client";
import {
  computeUnderwriting,
  seedAssumptions,
  UW_DEFAULTS,
  type UnderwritingResult,
} from "@/lib/underwriting/computeUnderwriting";

const hasSuite = (l: ListingDocument): boolean =>
  l.SuiteStatus === "EXISTING_SUITE" ||
  l.SuiteStatus === "POTENTIAL_CANDIDATE" ||
  Boolean(l.hasSecondarySuitePotential);

export interface UseCompareAssumptions {
  downPaymentPct: number;
  interestRatePct: number;
  setDownPaymentPct: (v: number) => void;
  setInterestRatePct: (v: number) => void;
  rentById: Record<string, number>;
  seededRentById: Record<string, number>;
  setRent: (id: string, v: number) => void;
  resultById: Record<string, UnderwritingResult>;
}

export function useCompareAssumptions(listings: ListingDocument[]): UseCompareAssumptions {
  const [downPaymentPct, setDownPaymentPct] = useState<number>(UW_DEFAULTS.downPaymentPct);
  const [interestRatePct, setInterestRatePct] = useState<number>(UW_DEFAULTS.interestRatePct);
  const [rentById, setRentById] = useState<Record<string, number>>({});

  const setRent = useCallback(
    (id: string, v: number) => setRentById((r) => ({ ...r, [id]: Math.max(0, v) })),
    []
  );

  const { resultById, seededRentById } = useMemo(() => {
    const results: Record<string, UnderwritingResult> = {};
    const seeds: Record<string, number> = {};
    for (const l of listings) {
      const base = seedAssumptions({
        listPrice: l.ListPrice,
        annualTaxes: l.TaxAnnualAmount ?? 0,
        monthlyFees: l.AssociationFee ?? 0,
        hasSuitePotential: hasSuite(l),
      });
      seeds[l.id] = base.monthlyRent;
      results[l.id] = computeUnderwriting({
        ...base,
        downPaymentPct,
        interestRatePct,
        monthlyRent: rentById[l.id] ?? base.monthlyRent,
      });
    }
    return { resultById: results, seededRentById: seeds };
  }, [listings, downPaymentPct, interestRatePct, rentById]);

  return {
    downPaymentPct, interestRatePct, setDownPaymentPct, setInterestRatePct,
    rentById, seededRentById, setRent, resultById,
  };
}
