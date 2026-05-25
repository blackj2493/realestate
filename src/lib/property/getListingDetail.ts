/**
 * getListingDetail — shared server-side fetch for a single listing.
 *
 * Returns the raw listing payload plus best-effort PureProperty Estimate (AVM)
 * and Condo Fee Stability. Wrapped in React `cache()` so a Server Component and
 * its `generateMetadata` share ONE Supabase round-trip per request.
 *
 * Source: the `listings` table (active IDX feed) via the service-role client.
 * Sold/VOW data lives elsewhere and is never served here.
 */

import { cache } from "react";
import { getServiceRoleClient } from "@/lib/supabase/client";
import { calculateAVM } from "@/lib/avm/calculator";
import { mapListingToAVMInput } from "@/lib/avm/mapListingToAVMInput";
import type { AVMResult } from "@/lib/avm/types";
import {
  isCondo,
  buildFeeStabilityResult,
  type FeeStabilityResult,
  type AreaStats,
  type CorpStats,
  type TrendBucket,
} from "@/lib/condo/feeStability";
import { calculateProForma } from "@/lib/typesense/ExtrapolatedCapRateEngine";
import { computeDealScore, type DealScoreResult } from "@/lib/dealScore/computeDealScore";

export interface ListingDetail {
  listing_key: string;
  full_payload: Record<string, unknown>;
  media_urls: string[];
  city: string | null;
  property_sub_type: string | null;
  synced_at: string | null;
  estimate: AVMResult | null;
  feeStability: FeeStabilityResult;
  dealScore: DealScoreResult;
}

/** Days on market: prefer the feed's DaysOnMarket, else derive from entry timestamp. */
function deriveDomDays(payload: Record<string, unknown>): number | null {
  const dom = payload["DaysOnMarket"];
  if (typeof dom === "number" && dom >= 0) return dom;
  const ts = payload["OriginalEntryTimestamp"];
  if (typeof ts === "string" && ts) {
    const diff = Date.now() - new Date(ts).getTime();
    if (Number.isFinite(diff)) return Math.max(0, Math.ceil(diff / 86_400_000) - 1);
  }
  return null;
}

function withTimeout<T>(promise: PromiseLike<T>, ms: number, label: string): Promise<T> {
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`${label} timeout`)), ms);
  });
  return Promise.race([promise, timeout]);
}

/**
 * Fetch one listing by its TRREB ListingKey. Returns null when the listing is
 * not in the database (caller decides whether to 404 or trigger a quick-sync).
 */
export const getListingDetail = cache(
  async (listingKey: string): Promise<ListingDetail | null> => {
    const supabase = getServiceRoleClient();

    const { data: listing, error } = await withTimeout(
      supabase
        .from("listings")
        .select("*")
        .eq("listing_key", listingKey)
        .maybeSingle(),
      10000,
      "Supabase query"
    );

    if (error) {
      throw new Error(`Database query failed: ${error.message}`);
    }
    if (!listing) {
      return null;
    }

    // Best-effort PureProperty Estimate (AVM). Never blocks the listing.
    let estimate: AVMResult | null = null;
    try {
      const avmInput = mapListingToAVMInput(listing.full_payload);
      if (avmInput) {
        estimate = await withTimeout(calculateAVM(supabase, avmInput), 8000, "AVM");
      }
    } catch (avmError) {
      console.error(`[getListingDetail] AVM failed for ${listingKey}:`, avmError);
    }

    // Best-effort Condo Fee Stability. Two indexed point-lookups on the
    // precomputed condo_fee_stats table — never scans raw_vow_sold at request time.
    let feeStability: FeeStabilityResult = { available: false, trend: null };
    try {
      const payload = listing.full_payload as Record<string, unknown> | null;
      if (isCondo(payload)) {
        const cityRegion = String(payload?.["CityRegion"] ?? "").trim();
        const subType = String(payload?.["PropertySubType"] ?? "").trim();
        const corpRaw = payload?.["CondoCorpNumber"];
        const corpKey =
          corpRaw === null || corpRaw === undefined ? "" : String(corpRaw).trim();

        const [areaRes, corpRes] = await Promise.all([
          cityRegion && subType
            ? supabase
                .from("condo_fee_stats")
                .select("median_fee_psf, p25_fee_psf, p75_fee_psf, sample_count, inclusions_mixed")
                .eq("cohort_type", "area")
                .eq("cohort_key", cityRegion)
                .eq("property_sub_type", subType)
                .maybeSingle()
            : Promise.resolve({ data: null }),
          corpKey && corpKey !== "0"
            ? supabase
                .from("condo_fee_stats")
                .select("trend_buckets, pct_change_24mo, sample_count, inclusions_mixed")
                .eq("cohort_type", "corp")
                .eq("cohort_key", corpKey)
                .eq("property_sub_type", "ALL")
                .maybeSingle()
            : Promise.resolve({ data: null }),
        ]);

        const areaRow = areaRes.data as Record<string, unknown> | null;
        const area: AreaStats | null = areaRow
          ? {
              medianPsf: Number(areaRow.median_fee_psf),
              p25Psf: Number(areaRow.p25_fee_psf),
              p75Psf: Number(areaRow.p75_fee_psf),
              sampleCount: Number(areaRow.sample_count),
              inclusionsMixed: areaRow.inclusions_mixed === true,
            }
          : null;

        const corpRow = corpRes.data as Record<string, unknown> | null;
        const corp: CorpStats | null = corpRow
          ? {
              buckets: (corpRow.trend_buckets as TrendBucket[]) ?? [],
              pctChange24mo: Number(corpRow.pct_change_24mo),
              sampleCount: Number(corpRow.sample_count),
              inclusionsMixed: corpRow.inclusions_mixed === true,
            }
          : null;

        feeStability = buildFeeStabilityResult({ payload, cityRegion, area, corp });
      }
    } catch (feeError) {
      console.error(`[getListingDetail] Fee stability failed for ${listingKey}:`, feeError);
    }

    // Deal Score — deterministic 0–100 score over already-derived metrics (§4: no LLM).
    const payload = (listing.full_payload as Record<string, unknown>) ?? {};
    const listPrice =
      typeof payload["ListPrice"] === "number" ? (payload["ListPrice"] as number) : null;
    const originalListPrice =
      typeof payload["OriginalListPrice"] === "number"
        ? (payload["OriginalListPrice"] as number)
        : null;
    const taxAnnualAmount =
      typeof payload["TaxAnnualAmount"] === "number" ? (payload["TaxAnnualAmount"] as number) : null;
    const associationFee =
      typeof payload["AssociationFee"] === "number" ? (payload["AssociationFee"] as number) : null;
    const proForma = calculateProForma(listPrice, { listPrice: listPrice ?? 0, taxAnnualAmount, associationFee });

    const dealScore = computeDealScore({
      listPrice,
      originalListPrice,
      avmEstimate: estimate
        ? { estimatedValue: estimate.estimatedValue, confidence: estimate.confidence }
        : null,
      domDays: deriveDomDays(payload),
      capRatePct: proForma.extrapolated_cap_rate > 0 ? proForma.extrapolated_cap_rate : null,
    });

    return {
      listing_key: listing.listing_key,
      full_payload: payload,
      media_urls: listing.media_urls || [],
      city: listing.city ?? null,
      property_sub_type: listing.property_sub_type ?? null,
      synced_at: listing.synced_at ?? null,
      estimate,
      feeStability,
      dealScore,
    };
  }
);
