/**
 * Server-side data layer for the Compare page.
 *
 * Lines up the selected listings (Typesense base docs, by id) with their nightly-
 * precomputed PureProperty Estimate + resolved GLA/$psf (property_estimates). Reading
 * the cached estimate is one batched PK lookup — no live AVM, so Compare renders
 * instantly (the AVM's multi-query cost was paid by refresh-property-estimates.ts).
 *
 * Deterministic, no AI (CLAUDE.md §4). Server-only (uses the service-role client) —
 * the Compare client component imports only its TYPES, so this never reaches the
 * browser bundle.
 */

import { getServiceRoleClient } from "@/lib/supabase/client";
import { searchListings, type ListingDocument } from "@/lib/typesense/client";
import { getCloseListRatio } from "@/lib/property/getCloseListRatio";
import { computeExpectedSale } from "@/lib/avm/expectedSale";
import { resolveSalePrice, type SalePriceEstimate } from "@/lib/avm/salePrice";
import type { AVMResult } from "@/lib/avm/types";

export type EstimateConfidence = "HIGH" | "MEDIUM" | "LOW";

export interface CompareEstimate {
  /** PureProperty Estimate (AVM), or null when the market is below the comps/R² gate. */
  estimatedValue: number | null;
  confidence: EstimateConfidence | null;
  /** Resolved gross living area (sqft) — measured rooms → calibrated → range midpoint. */
  glaSqft: number | null;
  /** list_price / glaSqft — the corrected $/sqft (BuildingAreaTotal is ~never filled). */
  ppsf: number | null;
}

export interface CompareData {
  /** Base listing docs, in the user-selected order. */
  listings: ListingDocument[];
  /** Per-listing-key cached estimate (missing key = no precomputed estimate yet). */
  estimates: Record<string, CompareEstimate>;
  /**
   * Per-listing-key single "Estimated Sale Price" (list-anchored where we can, AVM
   * fallback) — the SAME number the listing page shows, so Compare stays consistent.
   */
  salePrices: Record<string, SalePriceEstimate | null>;
}

/**
 * Resolve the single Estimated Sale Price per compared listing. List-anchored where a
 * trustworthy cohort close/list ratio exists (getCloseListRatio is unstable_cache'd 24h
 * per cohort, so a handful of compared listings is cheap), else the cached AVM. Mirrors
 * the listing page's resolveSalePrice so the number is identical across surfaces.
 */
async function fetchSalePrices(
  listings: ListingDocument[],
  estimates: Record<string, CompareEstimate>
): Promise<Record<string, SalePriceEstimate | null>> {
  const out: Record<string, SalePriceEstimate | null> = {};
  await Promise.all(
    listings.map(async (l) => {
      const listPrice = l.ListPrice && l.ListPrice > 0 ? l.ListPrice : null;
      let expectedSale = null;
      if (listPrice) {
        try {
          const ratio = await getCloseListRatio(l.City ?? null, l.PropertySubType ?? null);
          expectedSale = computeExpectedSale(listPrice, ratio);
        } catch {
          expectedSale = null;
        }
      }
      const est = estimates[l.id];
      // Slim AVM shim for the fallback path (resolver only reads these fields). The compare
      // estimate carries no bands; the resolver synthesizes a ±10% one when it falls back.
      const avmShim: AVMResult | null =
        est?.estimatedValue && est.estimatedValue > 0
          ? ({
              estimatedValue: est.estimatedValue,
              anchorPrice: est.estimatedValue,
              lowBand: 0,
              highBand: 0,
              confidence: est.confidence ?? "LOW",
            } as AVMResult)
          : null;
      out[l.id] = resolveSalePrice({ listPrice, isActive: true, expectedSale, estimate: avmShim });
    })
  );
  return out;
}

async function fetchEstimates(ids: string[]): Promise<Record<string, CompareEstimate>> {
  try {
    const sb = getServiceRoleClient();
    const { data, error } = await sb
      .from("property_estimates")
      .select("listing_key, estimated_value, confidence, gla_sqft, ppsf")
      .in("listing_key", ids);
    if (error || !data) return {};

    const out: Record<string, CompareEstimate> = {};
    for (const r of data) {
      const conf = r.confidence as EstimateConfidence | null;
      out[r.listing_key as string] = {
        estimatedValue: r.estimated_value != null ? Number(r.estimated_value) : null,
        confidence: conf === "HIGH" || conf === "MEDIUM" || conf === "LOW" ? conf : null,
        glaSqft: r.gla_sqft != null ? Number(r.gla_sqft) : null,
        ppsf: r.ppsf != null ? Number(r.ppsf) : null,
      };
    }
    return out;
  } catch {
    // The estimate is additive — never let a missing table/row break Compare.
    return {};
  }
}

export async function getCompareData(ids: string[]): Promise<CompareData> {
  if (ids.length === 0) return { listings: [], estimates: {}, salePrices: {} };

  const [listingsRes, estimates] = await Promise.all([
    searchListings({ query: "*", rawFilterBy: `id:[${ids.join(",")}]`, perPage: ids.length }),
    fetchEstimates(ids),
  ]);

  // Preserve the order the user selected them in.
  const byId = new Map(listingsRes.listings.map((l) => [l.id, l]));
  const listings = ids
    .map((id) => byId.get(id))
    .filter((l): l is ListingDocument => Boolean(l));

  const salePrices = await fetchSalePrices(listings, estimates);

  return { listings, estimates, salePrices };
}
