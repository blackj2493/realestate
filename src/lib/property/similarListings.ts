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
