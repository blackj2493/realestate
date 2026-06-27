/**
 * Persona-aware ranking. The SAME result set is ordered (and badged) by what the
 * active persona actually cares about — a Flipper sees price-drops / stale / DOM
 * first; a Cashflow investor sees cap-rate / yield first. Pure + client-side
 * (reads only fields already on the doc), so it adds zero queries.
 */

import type { ListingDocument } from "@/lib/typesense/client";
import type { PersonaType } from "@/lib/personas/personaConfig";
import { capRateOrNull, grossYieldOrNull } from "@/lib/metrics/sanityBand";

export type BadgeTone = "drop" | "stale" | "dom" | "cap" | "yield" | "carry" | "lot" | "zoning";

export interface RankBadge {
  label: string;
  tone: BadgeTone;
}

export interface RankedListing {
  listing: ListingDocument;
  score: number;
  badges: RankBadge[];
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const moneyK = (n: number) => (n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${Math.round(n)}`);

function flipperScore(d: ListingDocument): { score: number; badges: RankBadge[] } {
  const badges: RankBadge[] = [];
  const drop = d.TotalPriceDrop ?? 0;
  const dom = d.TrueDom ?? d.calculatedDOM ?? 0;
  if (drop > 0) {
    const pct = d.OriginalListPrice && d.OriginalListPrice > 0 ? (drop / d.OriginalListPrice) * 100 : 0;
    badges.push({ label: pct >= 1 ? `▼ ${pct.toFixed(0)}% drop` : `▼ ${moneyK(drop)}`, tone: "drop" });
  }
  if (d.IsStale) badges.push({ label: `stale ${dom}d`, tone: "stale" });
  else if (dom > 0) badges.push({ label: `${dom}d DOM`, tone: "dom" });
  const score = clamp01(drop / 150_000) * 0.55 + (d.IsStale ? 0.25 : 0) + clamp01(dom / 180) * 0.2;
  return { score, badges };
}

function cashflowScore(d: ListingDocument): { score: number; badges: RankBadge[] } {
  const badges: RankBadge[] = [];
  const cap = capRateOrNull(d.cap_rate_est);
  const yld = grossYieldOrNull(d.gross_yield_est);
  if (cap != null) badges.push({ label: `cap ${cap.toFixed(1)}%`, tone: "cap" });
  if (yld != null) badges.push({ label: `yield ${yld.toFixed(1)}%`, tone: "yield" });
  if (d.MonthlyCarryCost) badges.push({ label: `carry ${moneyK(d.MonthlyCarryCost)}/mo`, tone: "carry" });
  const score = clamp01((cap ?? 0) / 10) * 0.7 + clamp01((yld ?? 0) / 10) * 0.3;
  return { score, badges };
}

function builderScore(d: ListingDocument): { score: number; badges: RankBadge[] } {
  const badges: RankBadge[] = [];
  const lot = d.LotSqftTotal ?? 0;
  const width = d.LotWidth ?? d.lot_width_ft ?? 0;
  if (lot > 0) badges.push({ label: `${Math.round(lot).toLocaleString()} sf lot`, tone: "lot" });
  else if (width > 0) badges.push({ label: `${width}′ frontage`, tone: "lot" });
  if (d.is_density_ready) badges.push({ label: "density-ready", tone: "zoning" });
  const score = clamp01(lot / 12_000) * 0.5 + clamp01(width / 80) * 0.3 + (d.is_density_ready ? 0.2 : 0);
  return { score, badges };
}

function homebuyerScore(d: ListingDocument): { score: number; badges: RankBadge[] } {
  // Homebuyer: freshest + best school, gentlest carry. Surfaces a quality signal.
  const badges: RankBadge[] = [];
  const school = d.BestSchoolScoreNearby ?? Math.max(d.BestElementaryScore ?? 0, d.BestSecondaryScore ?? 0);
  if (school > 0) badges.push({ label: `school ${school.toFixed(1)}`, tone: "cap" });
  const dom = d.TrueDom ?? d.calculatedDOM ?? 0;
  if (dom > 0) badges.push({ label: `${dom}d DOM`, tone: "dom" });
  const score = clamp01(school / 10) * 0.7 + clamp01(1 - dom / 180) * 0.3;
  return { score, badges };
}

const SCORERS: Record<PersonaType, (d: ListingDocument) => { score: number; badges: RankBadge[] }> = {
  flippers: flipperScore,
  cashflow: cashflowScore,
  builders: builderScore,
  smart: homebuyerScore,
};

/**
 * Rank + badge a result set for a persona. Stable: ties keep the input order
 * (Typesense relevance), so ranking only *reorders by signal strength* where a
 * signal exists, never shuffles randomly.
 */
export function rankListings(listings: ListingDocument[], persona: PersonaType): RankedListing[] {
  const scorer = SCORERS[persona] ?? homebuyerScore;
  return listings
    .map((listing, i) => {
      const { score, badges } = scorer(listing);
      return { listing, score, badges, _i: i };
    })
    .sort((a, b) => b.score - a.score || a._i - b._i)
    .map(({ listing, score, badges }) => ({ listing, score, badges }));
}
