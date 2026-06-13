/**
 * Similar-listings similarity scoring — pure, deterministic, node-env testable.
 *
 * Drives the listing page's "comparable properties" band. Two lists relax in
 * opposite orders (buyer browse vs appraiser comps); see
 * docs/superpowers/specs/2026-06-13-similar-properties-design.md. No framework
 * imports — keep it pure so vitest (node-env) can test it directly.
 */
import { PROPERTY_TYPE_OPTIONS } from "@/lib/dashboard/propertyTypes";

export type FormFamily = "ground" | "apartment" | "land" | "other";

const GROUND_KEYS = new Set(["detached", "semi", "town", "link", "multiplex"]);
const APARTMENT_KEYS = new Set(["condo"]);
const LAND_KEYS = new Set(["vacant"]);

// Exact PropertySubType spelling -> option key (handles trailing-space variants).
const SUBTYPE_TO_KEY = new Map<string, string>();
for (const opt of PROPERTY_TYPE_OPTIONS) {
  for (const v of opt.variants) SUBTYPE_TO_KEY.set(v, opt.key);
}

/** The PROPERTY_TYPE_OPTIONS key for a raw sub-type spelling, or null if unmapped. */
export function optionKeyForSubType(subType: string | null): string | null {
  if (!subType) return null;
  return SUBTYPE_TO_KEY.get(subType) ?? null;
}

/** Map a sub-type to its form family. The family is the hard wall we never cross. */
export function formFamily(subType: string | null): FormFamily {
  const key = optionKeyForSubType(subType);
  if (!key) return "other";
  if (GROUND_KEYS.has(key)) return "ground";
  if (APARTMENT_KEYS.has(key)) return "apartment";
  if (LAND_KEYS.has(key)) return "land";
  return "other";
}

/** Every exact sub-type spelling in the subject's family (for the Typesense OR-clause).
 *  'other' (unmapped) returns just the raw sub-type so we only match identical spellings. */
export function familySubtypeVariants(subType: string | null): string[] {
  const fam = formFamily(subType);
  if (fam === "other") return subType ? [subType] : [];
  const keys = fam === "ground" ? GROUND_KEYS : fam === "apartment" ? APARTMENT_KEYS : LAND_KEYS;
  const out: string[] = [];
  for (const opt of PROPERTY_TYPE_OPTIONS) {
    if (keys.has(opt.key)) for (const v of opt.variants) if (!out.includes(v)) out.push(v);
  }
  return out;
}

/** Asymmetric bed closeness: exact best, then +1 over -1, decaying to a floor. */
export function bedScore(subjectBeds: number, candBeds: number): number {
  const d = candBeds - subjectBeds;
  if (d === 0) return 1;
  if (d === 1) return 0.85;
  if (d === 2) return 0.6;
  if (d === -1) return 0.6;
  if (d === -2) return 0.3;
  return 0.1;
}

/** Linear price closeness, 1 at equal, 0 at >=50% delta. Neutral if either is <=0. */
export function priceScore(subjectPrice: number, candPrice: number): number {
  if (subjectPrice <= 0 || candPrice <= 0) return 0.5;
  const rel = Math.abs(candPrice - subjectPrice) / subjectPrice;
  return Math.max(0, 1 - rel / 0.5);
}

/** Size closeness; neutral 0.5 when either area is missing (feed has ~0% exact sqft). */
export function sizeScore(subjectArea: number, candArea: number): number {
  if (subjectArea <= 0 || candArea <= 0) return 0.5;
  const rel = Math.abs(candArea - subjectArea) / subjectArea;
  return Math.max(0, 1 - rel / 0.5);
}

/** 1 for same CityRegion, 0.4 for same-city-only (neighbourhood-first ranking). */
export function regionScore(subjectRegion: string | null, candRegion: string | null): number {
  if (subjectRegion && candRegion && subjectRegion === candRegion) return 1;
  return 0.4;
}

/** 1 when sub-types share an option key (Detached==Detached), else 0.5 (same family). */
export function subtypeScore(subjectSubType: string | null, candSubType: string | null): number {
  const a = optionKeyForSubType(subjectSubType);
  const b = optionKeyForSubType(candSubType);
  if (a && b && a === b) return 1;
  return 0.5;
}

/** Recency of a sold comp by days since contract date. */
export function recencyScore(daysAgo: number): number {
  if (daysAgo <= 30) return 1;
  if (daysAgo <= 90) return 0.8;
  if (daysAgo <= 180) return 0.5;
  return 0.3;
}

export type MatchTier = "close" | "partial" | "sparse" | "none";
export type SimilarKind = "sale" | "sold";

/** The subject listing's match attributes (its own public fields, from the page). */
export interface SubjectAttrs {
  id: string;
  cityRegion: string | null;
  city: string | null;
  subType: string | null;
  beds: number;
  listPrice: number;
  area: number; // BuildingAreaTotal, 0 when unknown
}

/** A candidate comp's attributes (mapped from a Typesense doc by the route). */
export interface CandidateAttrs {
  cityRegion: string | null;
  subType: string | null;
  beds: number;
  price: number; // ListPrice (sale) or ClosePrice (sold)
  area: number; // 0 when unknown
  daysAgo?: number; // sold only
}

export interface RankedSimilar<T> {
  item: T;
  score: number;
  why: string;
  regionExact: boolean;
  subtypeExact: boolean;
}

// Weights — buyer browse keeps location/price; appraiser comps drop price, weight recency+size.
export function scoreForSale(s: SubjectAttrs, c: CandidateAttrs): number {
  return (
    30 * regionScore(s.cityRegion, c.cityRegion) +
    20 * subtypeScore(s.subType, c.subType) +
    20 * bedScore(s.beds, c.beds) +
    20 * priceScore(s.listPrice, c.price) +
    10 * sizeScore(s.area, c.area)
  );
}

export function scoreSold(s: SubjectAttrs, c: CandidateAttrs): number {
  return (
    20 * regionScore(s.cityRegion, c.cityRegion) +
    20 * subtypeScore(s.subType, c.subType) +
    15 * bedScore(s.beds, c.beds) +
    20 * sizeScore(s.area, c.area) +
    25 * recencyScore(c.daysAgo ?? 999)
  );
}

const KEY_TO_LABEL = new Map(PROPERTY_TYPE_OPTIONS.map((o) => [o.key, o.label]));

/** Human-readable reason a candidate is comparable (drives the per-card chip). */
export function buildWhyLabel(s: SubjectAttrs, c: CandidateAttrs, kind: SimilarKind): string {
  const region =
    regionScore(s.cityRegion, c.cityRegion) === 1
      ? "Same neighbourhood"
      : s.city
        ? `Nearby in ${s.city}`
        : "Nearby";
  const key = optionKeyForSubType(c.subType);
  const typeLabel = key ? KEY_TO_LABEL.get(key) ?? "" : "";
  const form = [c.beds > 0 ? `${c.beds}bd` : "", typeLabel].filter(Boolean).join(" ");
  let label = [region, form].filter(Boolean).join(" · ");
  if (kind === "sold" && c.daysAgo != null && c.daysAgo >= 0) {
    label += ` · sold ${Math.round(c.daysAgo)}d ago`;
  }
  return label;
}

/** Score + sort + cap candidates, tagging each with its why-label and exact flags. */
export function rankSimilar<T>(
  subject: SubjectAttrs,
  items: T[],
  toAttrs: (t: T) => CandidateAttrs,
  kind: SimilarKind,
  limit = 8
): RankedSimilar<T>[] {
  const scorer = kind === "sale" ? scoreForSale : scoreSold;
  return items
    .map((item) => {
      const c = toAttrs(item);
      return {
        item,
        score: scorer(subject, c),
        why: buildWhyLabel(subject, c, kind),
        regionExact: regionScore(subject.cityRegion, c.cityRegion) === 1,
        subtypeExact: subtypeScore(subject.subType, c.subType) === 1,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Tier the list's match strength: drives the header badge + honest-stop note. */
export function classifyMatchQuality(
  ranked: Array<{ regionExact: boolean; subtypeExact: boolean }>
): MatchTier {
  const n = ranked.length;
  if (n === 0) return "none";
  if (n <= 3) return "sparse";
  const strong = ranked.slice(0, 4).filter((r) => r.regionExact && r.subtypeExact).length;
  return strong >= 2 ? "close" : "partial";
}

const DAY_MS = 86_400_000;

/** Backtick-quote a Typesense filter value (strip embedded backticks). */
function bq(v: string): string {
  return `\`${v.replace(/`/g, "")}\``;
}

/** OR-clause over the subject family's exact sub-type spellings, or "" if none. */
function familyClause(subType: string | null): string {
  const variants = familySubtypeVariants(subType);
  if (variants.length === 0) return "";
  return `(${variants.map((v) => `PropertySubType:=${bq(v)}`).join(" || ")})`;
}

/** Wide-net For-Sale filter: active + city floor + family wall. (Subject excluded in JS.) */
export function buildForSaleSimilarFilter(s: SubjectAttrs): string {
  const clauses: string[] = ["TransactionType:=`For Sale`"];
  if (s.city) clauses.push(`City:=${bq(s.city)}`);
  const fam = familyClause(s.subType);
  if (fam) clauses.push(fam);
  return clauses.join(" && ");
}

/** Wide-net Sold filter: sold + price floor + window + city floor + family wall.
 *  `nowMs` is injected (not Date.now()) so the output is deterministic for tests. */
export function buildSoldSimilarFilter(s: SubjectAttrs, windowDays: number, nowMs: number): string {
  const cutoff = Math.floor(nowMs - windowDays * DAY_MS);
  const clauses: string[] = [
    "DealType:=sold",
    "ClosePrice:>=1",
    `PurchaseContractDate:>=${cutoff}`,
    `PurchaseContractDate:<=${nowMs}`,
  ];
  if (s.city) clauses.push(`(City:=${bq(s.city)} || CityRegion:=${bq(s.city)})`);
  const fam = familyClause(s.subType);
  if (fam) clauses.push(fam);
  return clauses.join(" && ");
}
