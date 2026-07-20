/**
 * Condo fee board — server-side data for the public /data/condo-fees tracker.
 *
 * Reads the 'area_trend' cohorts precomputed weekly by
 * scripts/admin/refresh-condo-fee-stats.ts: per NEIGHBOURHOOD, the median of its member
 * buildings' annualized fee trends (one vote per building), the spread, and the area's
 * current fee/sqft distribution.
 *
 * Deliberately AREA-level: individual buildings are never named publicly. Aggregate
 * statistics only — no listing rows.
 */
import { unstable_cache } from "next/cache";
import { getServiceRoleClient } from "@/lib/supabase/client";
import { TREND_MAX_ANNUAL_PCT, classifyTrend, type TrendBand } from "@/lib/condo/feeStability";
import { cityHubSlug, deslugCity } from "@/lib/listings/listingPath";

export interface CondoAreaRow {
  /** Neighbourhood (TRREB CityRegion). */
  area: string;
  city: string;
  /** Median annualized fee trend of member buildings, %/yr. */
  annualPct: number;
  p25AnnualPct: number | null;
  p75AnnualPct: number | null;
  buildingCount: number;
  sampleCount: number;
  /** Current typical maintenance fee, $/sqft/month. */
  medianPsf: number | null;
  band: TrendBand;
}

export interface CondoFeeBoard {
  rows: CondoAreaRow[];
  dataAsOf: string | null;
}

interface MetaShape {
  city?: unknown;
  p25AnnualPct?: unknown;
  p75AnnualPct?: unknown;
  buildingCount?: unknown;
}

const num = (v: unknown): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * TRREB stores Toronto as district codes ("Toronto C02", "Toronto W08") — meaningless
 * to a public reader. Round-trip through the canonical hub-slug helpers so districts
 * consolidate to their municipality ("Toronto") using the same rules as the hub tree,
 * rather than a second private copy of that regex.
 */
function displayCity(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const slug = cityHubSlug(trimmed);
  return slug ? deslugCity(slug) : trimmed;
}

async function computeCondoFeeBoard(): Promise<CondoFeeBoard> {
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("condo_fee_stats")
    .select("cohort_key, pct_change_24mo, median_fee_psf, sample_count, meta, updated_at")
    .eq("cohort_type", "area_trend")
    .order("pct_change_24mo", { ascending: false });
  if (error || !data) return { rows: [], dataAsOf: null };

  let newest: string | null = null;
  const rows: CondoAreaRow[] = [];
  for (const r of data as Record<string, unknown>[]) {
    const annualPct = num(r.pct_change_24mo);
    const area = String(r.cohort_key ?? "").trim();
    if (annualPct == null || !area) continue;
    // Defence in depth: never surface a trend beyond the estimator's clamp, so a stale
    // row written by superseded logic can't reach a public page as a wild number.
    if (Math.abs(annualPct) > TREND_MAX_ANNUAL_PCT) continue;

    const meta = (r.meta ?? {}) as MetaShape;
    const buildingCount = num(meta.buildingCount) ?? 0;
    if (buildingCount <= 0) continue;

    const updated = typeof r.updated_at === "string" ? r.updated_at : null;
    if (updated && (!newest || updated > newest)) newest = updated;

    rows.push({
      area,
      city: displayCity(String(meta.city ?? "")),
      annualPct,
      p25AnnualPct: num(meta.p25AnnualPct),
      p75AnnualPct: num(meta.p75AnnualPct),
      buildingCount,
      sampleCount: num(r.sample_count) ?? 0,
      medianPsf: num(r.median_fee_psf),
      band: classifyTrend(annualPct),
    });
  }
  return { rows, dataAsOf: newest };
}

/** Cached condo fee board (6h — the source refreshes weekly). */
export function getCondoFeeBoard(): Promise<CondoFeeBoard> {
  return unstable_cache(computeCondoFeeBoard, ["data-condo-fee-board", "v1"], {
    revalidate: 21600,
  })();
}

/** Uncached — for the nightly data-health canary (runs outside a Next request context). */
export function computeCondoFeeBoardUncached(): Promise<CondoFeeBoard> {
  return computeCondoFeeBoard();
}
