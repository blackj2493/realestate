/**
 * Condition Scoring — deterministic interior / exterior / basement tiers.
 *
 * CLAUDE.md §4 compliance: 100% deterministic, hardcoded logic. No LLM, no AI.
 * Pure functions with no side effects (no Supabase, no fetch) — safe to import
 * from both the Next.js app and the ETL worker scripts.
 *
 * Tier convention is fixed by the AVM calculator (src/lib/avm/calculator.ts):
 *   interior_tier 1-5  (1 = best,  score = 6 - tier)
 *   exterior_tier 1-5  (1 = best,  score = 5 - tier)
 *   basement_tier 1-9  (1 = best,  score = 10 - tier)
 * When there is no structured signal at all, return NEUTRAL_TIER so a sparsely
 * filled listing is never penalised for missing data.
 */

export const NEUTRAL_TIER = 3;

type Payload = Record<string, unknown> | null | undefined;

/**
 * Normalise a TRREB "String List" field into lowercased, trimmed tokens.
 * Accepts an array of strings, a comma-separated string, or null/undefined.
 * Empty / missing / null all collapse to [] (treated as "no data").
 */
function normalizeFeatures(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((v): v is string => typeof v === 'string')
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  }
  return [];
}

const includesAny = (tokens: string[], keyword: string): boolean =>
  tokens.some((t) => t.includes(keyword));

// ───────────────────────────────────────────────────────────────────────────
// Interior — from property-level InteriorFeatures (amenity richness only;
// flooring / pot lights live in per-room RoomFeatures and are out of scope).
// ───────────────────────────────────────────────────────────────────────────

// Centered at neutral: property-level InteriorFeatures carries no *below*-average
// signal (there is no "cheap interior" amenity), so the typical listing maps to
// NEUTRAL_TIER and only premium amenities pull it upward (3 → 2 → 1). Tiers 4-5
// are unreachable here by design — they need room-level finishes (Phase 5).
export const INTERIOR_BANDS = { t1: 4, t2: 2 } as const;

export function deriveInteriorTier(payload: Payload): number {
  const feats = normalizeFeatures(payload?.['InteriorFeatures']);
  if (feats.length === 0) return NEUTRAL_TIER; // no data → neutral

  const has = (kw: string) => includesAny(feats, kw);
  let pts = 0;

  if (has('sauna')) pts += 2;
  if (has('in-law') || has('accessory apartment') || has('guest accommodation')) pts += 2;
  if (has('central vac')) pts += 1;
  if (has('built-in oven') || has('countertop range')) pts += 1;
  if (has('upgraded insulation')) pts += 1;
  if (has('carpet free')) pts += 1;

  // Water / air systems — capped at +2 so a feature-stuffed listing can't run away.
  let systems = 0;
  if (has('on demand water heater') || has('on-demand')) systems += 1;
  if (has('erv') || has('hrv')) systems += 1;
  if (has('water purifier')) systems += 1;
  if (has('water softener')) systems += 1;
  pts += Math.min(systems, 2);

  if (pts >= INTERIOR_BANDS.t1) return 1;
  if (pts >= INTERIOR_BANDS.t2) return 2;
  return NEUTRAL_TIER; // typical: no / minimal premium amenities listed
}

// ───────────────────────────────────────────────────────────────────────────
// Exterior — ConstructionMaterials (build quality) + PoolFeatures (in-ground
// outscores above-ground) + ExteriorFeatures (outdoor living / hardscape).
// ───────────────────────────────────────────────────────────────────────────

// Centered so a plain brick house (material +2, the modal exterior) lands at the
// neutral tier 3; cheaper siding with nothing drops to 4-5, pools/stone/features lift to 2-1.
export const EXTERIOR_BANDS = { t1: 8, t2: 5, t3: 2, t4: 1 } as const;
const EXTERIOR_OUTDOOR_KEYWORDS = [
  'deck',
  'patio',
  'porch',
  'landscaped',
  'sprinkler',
  'bbq',
  'privacy',
  'green belt',
  'lighting',
] as const;

export function deriveExteriorTier(payload: Payload): number {
  const materials = normalizeFeatures(payload?.['ConstructionMaterials']);
  const pool = normalizeFeatures(payload?.['PoolFeatures']);
  const ext = normalizeFeatures(payload?.['ExteriorFeatures']);

  if (materials.length === 0 && pool.length === 0 && ext.length === 0) {
    return NEUTRAL_TIER; // no data → neutral
  }

  const waterfront =
    payload?.['WaterfrontYN'] === true || normalizeFeatures(payload?.['Waterfront']).length > 0;
  const coveredSpaces = Number(payload?.['CoveredSpaces']) || 0;

  let pts = 0;

  // Material — score the single best material present.
  const matHas = (kw: string) => includesAny(materials, kw);
  if (matHas('stone')) pts += 3;
  else if (matHas('brick')) pts += 2;
  else if (
    matHas('stucco') ||
    matHas('plaster') ||
    matHas('wood') ||
    matHas('log') ||
    matHas('concrete') ||
    matHas('shingle') ||
    matHas('board')
  )
    pts += 1;
  // vinyl / aluminum / metal / steel / insulbrick → 0

  // Pool — in-ground / indoor is the value driver; above-ground is marginal.
  const poolHas = (kw: string) => includesAny(pool, kw);
  if (poolHas('inground') || poolHas('in ground') || poolHas('in-ground') || poolHas('indoor')) {
    pts += 3;
    if (poolHas('salt')) pts += 1;
  } else if (poolHas('above ground') || poolHas('above-ground')) {
    pts += 1;
  }

  // Outdoor living / hardscape.
  if (includesAny(ext, 'hot tub')) pts += 2;
  for (const kw of EXTERIOR_OUTDOOR_KEYWORDS) {
    if (includesAny(ext, kw)) pts += 1;
  }

  if (waterfront) pts += 2;
  if (coveredSpaces >= 2) pts += 1;

  if (pts >= EXTERIOR_BANDS.t1) return 1;
  if (pts >= EXTERIOR_BANDS.t2) return 2;
  if (pts >= EXTERIOR_BANDS.t3) return 3;
  if (pts >= EXTERIOR_BANDS.t4) return 4;
  return 5;
}

// ───────────────────────────────────────────────────────────────────────────
// Basement — two axes: finish level × access (walk-out / separate entrance =
// suite / income potential). Reads payload.Basement (String List, Multi).
// ───────────────────────────────────────────────────────────────────────────

export const BASEMENT_NONE_TIER = 9;

export function deriveBasementTier(payload: Payload): number {
  const tokens = normalizeFeatures(payload?.['Basement']);
  if (tokens.length === 0) return BASEMENT_NONE_TIER;

  let apartment = false;
  let finished = false;
  let partiallyFinished = false;
  let unfinished = false;
  let full = false;
  let partial = false;
  let half = false;
  let crawl = false;

  for (const t of tokens) {
    if (t.includes('apartment')) apartment = true;
    if (t.includes('crawl')) crawl = true;
    if (t.includes('half')) half = true;
    if (t.includes('full')) full = true;
    if (t.includes('partial')) partial = true;

    // Finish level — order matters: "Unfinished" and "Partially Finished" both
    // contain the substring "finished", so check the qualifiers first.
    if (t.includes('unfinished')) unfinished = true;
    else if (t.includes('partially finished') || (t.includes('partial') && t.includes('finish')))
      partiallyFinished = true;
    else if (t.includes('finished')) finished = true;
  }

  const joined = tokens.join(' ');
  const walkOut =
    joined.includes('walk-out') || joined.includes('walk out') || joined.includes('walkout');
  const separateEntrance =
    joined.includes('separate entrance') || joined.includes('sep entrance');
  const walkUp =
    joined.includes('walk-up') || joined.includes('walk up') || joined.includes('walkup');
  const sideAccess = separateEntrance || walkUp;

  if (apartment) return 1; // a basement apartment is a rentable suite
  if (finished) {
    if (walkOut) return 1;
    if (sideAccess) return 2;
    return 3;
  }
  if (partiallyFinished) return walkOut || sideAccess ? 4 : 5;
  if (full || unfinished) return walkOut || sideAccess ? 6 : 7;
  if (partial || half || crawl) return 8;
  return BASEMENT_NONE_TIER; // None / Other / unknown
}

/**
 * True when the basement has any finished living space (incl. a basement
 * apartment or a partially finished basement). Used for the has_finished_basement
 * flag and the Suite-Potential persona.
 */
export function deriveHasFinishedBasement(payload: Payload): boolean {
  const tokens = normalizeFeatures(payload?.['Basement']);
  if (tokens.length === 0) return false;
  if (tokens.some((t) => t.includes('apartment'))) return true;
  return tokens.some((t) => t.includes('finished') && !t.includes('unfinished'));
}
