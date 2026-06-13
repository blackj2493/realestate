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
