/** Pure filter builders for the sold/delisted comp route — kept out of
 *  route.ts so node-env tests don't load next/server. */

import { aboveGradeBedsClause, exactAboveGradeBedsClause } from "@/lib/filters/filterRegistry";

const DAY_MS = 86_400_000;

/**
 * Area scoping for a sold query. Exactly one variant must be set; precedence at
 * the call site (GET handler) is polygon > nearby_school > region so a caller
 * accidentally passing multiple gets the most-specific filter.
 *
 *   - region:        traditional city/neighbourhood scoping (existing behaviour)
 *   - polygon:       [lat, lng, lat, lng, ...] from a draw / commute bubble
 *   - nearbySchool:  exact NearbySchools id (school catchment bubble)
 */
export type SoldArea =
  | { kind: "region"; region: string }
  | { kind: "polygon"; polygon: [number, number][] }
  | { kind: "school"; schoolKey: string };

export interface SoldParams {
  area: SoldArea;
  windowDays: number;
  typeKeys: string[];
  minPrice: number;
  maxPrice: number;
  minBeds: number;
  bedsExact: boolean;
  minBaths: number;
  bathsExact: boolean;
  minGarage: number;
  basementFinished: boolean;
  minFrontage: number;
  limit: number;
  dealType: "sold" | "leased" | "delisted";
}

/** Build the Typesense area clause (one per kind) — see SoldArea docstring. */
export function buildAreaClause(area: SoldArea): string {
  if (area.kind === "polygon") {
    const coords = area.polygon.map(([lat, lng]) => `${lat}, ${lng}`).join(", ");
    return `location:(${coords})`;
  }
  if (area.kind === "school") {
    const safe = area.schoolKey.replace(/`/g, "");
    return `NearbySchools:=\`${safe}\``;
  }
  const safe = area.region.replace(/`/g, "");
  return `(City:=\`${safe}\` || CityRegion:=\`${safe}\`)`;
}

/**
 * Parse a flat `lat,lng,lat,lng,...` polygon param. Returns null on any shape
 * issue (odd count, < 3 vertices, non-finite values) so the caller can fail
 * the request cleanly rather than ship a degenerate filter to Typesense.
 */
export function parsePolygonParam(raw: string): [number, number][] | null {
  const nums = raw
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n));
  if (nums.length % 2 !== 0) return null;
  if (nums.length < 6) return null; // ≥ 3 vertices required by Typesense
  const out: [number, number][] = [];
  for (let i = 0; i < nums.length; i += 2) out.push([nums[i], nums[i + 1]]);
  return out;
}

/** Build the Typesense filter_by string for the sold/leased/delisted lens.
 *
 * `variantsForKeysFn` is injected by the route (it imports dashboard code that
 * we don't want to pull into the pure test-env module). Pass undefined in tests.
 */
export function buildSoldFilter(
  p: SoldParams,
  variantsForKeysFn?: (keys: string[]) => string[]
): string {
  const cutoffMs = Math.floor(Date.now() - p.windowDays * DAY_MS);
  const clauses: string[] = [
    buildAreaClause(p.area),
    `PurchaseContractDate:>=${cutoffMs}`,
    `PurchaseContractDate:<=${Date.now()}`, // defensive: no future contract dates
  ];

  if (p.dealType === "delisted") {
    // De-listed rows: DealType carries the reason; there is no transaction so
    // no price floor; terminated LEASE listings are not sale leads.
    clauses.push(`DealType:=[terminated,expired,suspended]`);
    clauses.push(`TransactionType:=\`For Sale\``);
  } else {
    clauses.push(`DealType:=${p.dealType}`);
    clauses.push(`ClosePrice:>=1`);
  }

  // Price band — Sold/Leased filter the achieved sale price (ClosePrice); De-listed
  // rows never transacted, so the final ask (ListPrice) carries the band instead.
  const priceField = p.dealType === "delisted" ? "ListPrice" : "ClosePrice";
  if (p.minPrice > 0) clauses.push(`${priceField}:>=${Math.floor(p.minPrice)}`);
  if (p.maxPrice > 0) clauses.push(`${priceField}:<=${Math.floor(p.maxPrice)}`);

  const variants = variantsForKeysFn ? variantsForKeysFn(p.typeKeys) : [];
  if (variants.length > 0) {
    const ors = variants.map((v) => `PropertySubType:=\`${v.replace(/`/g, "")}\``);
    clauses.push(`(${ors.join(" || ")})`);
  }
  // Beds: above-grade with a total fallback — identical semantics to the For Sale
  // filter. "3 bd" means 3 ABOVE grade, so a 1+4 basement-heavy home no longer
  // surfaces under it. Min ("3+") vs Exact ("exactly 3") follows the bar's toggle.
  // Every doc carries an explicit BedroomsAboveGrade (de-listed + legacy backfilled
  // via backfill-delisted-bedroom-grade.ts), so the clause's `:=0` total-fallback
  // branch is reachable and nothing is silently dropped.
  if (p.minBeds > 0) {
    clauses.push(p.bedsExact ? exactAboveGradeBedsClause(p.minBeds) : aboveGradeBedsClause(p.minBeds));
  }
  if (p.minBaths > 0) clauses.push(`BathroomsTotalInteger:${p.bathsExact ? "=" : ">="}${p.minBaths}`);
  if (p.minGarage > 0) clauses.push(`ParkingTotal:>=${p.minGarage}`);
  // BasementTier 1-5 = finished/partially-finished space (deterministic tier).
  if (p.basementFinished) clauses.push(`BasementTier:<=5`);
  if (p.minFrontage > 0) clauses.push(`LotWidth:>=${p.minFrontage}`);

  return clauses.join(" && ");
}
