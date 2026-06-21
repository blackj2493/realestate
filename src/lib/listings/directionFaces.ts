/**
 * Direction-faces normaliser — folds the two TRREB fields that express "which way
 * the home faces" into one canonical compass value for the Faces filter:
 *   • DirectionFaces — freehold/house lookup ("North", "West", "South East", …)
 *   • Exposure       — condo unit lookup (same words, or "N"/"Sw" letter codes,
 *                      or dual "Ns"/"Ew" through-unit codes)
 *
 * Output is one of the 8 canonical points (Title Case, space-separated) or "" when
 * the feed value is missing/ambiguous (e.g. a dual N–S through-unit). "" simply
 * never matches a selected direction, which is the safe default. The canonical
 * strings ARE the filter option values AND the stored facet values — one source,
 * so the option value, the clause value, and the indexed value can never drift.
 *
 * Pure + deterministic (CLAUDE.md §4) — safe to import from the ETL worker, the
 * backfill script, and the app.
 */

export interface DirectionOption {
  value: string;
  label: string;
}

/** The 8 compass points in clockwise order. value = stored facet value = clause value. */
export const DIRECTION_OPTIONS: DirectionOption[] = [
  { value: "North", label: "North" },
  { value: "North East", label: "North-East" },
  { value: "East", label: "East" },
  { value: "South East", label: "South-East" },
  { value: "South", label: "South" },
  { value: "South West", label: "South-West" },
  { value: "West", label: "West" },
  { value: "North West", label: "North-West" },
];

// Every accepted feed spelling → canonical value. Full words and letter codes
// (incl. condo Exposure "Sw") both resolve here; anything absent → "" (unknown).
// Dual exposures ("Ns"/"Ew") are deliberately NOT listed → "" (a single-value
// facet can't honestly represent "faces both ways").
const CANONICAL: Record<string, string> = {
  n: "North", north: "North",
  s: "South", south: "South",
  e: "East", east: "East",
  w: "West", west: "West",
  ne: "North East", northeast: "North East", "north east": "North East",
  nw: "North West", northwest: "North West", "north west": "North West",
  se: "South East", southeast: "South East", "south east": "South East",
  sw: "South West", southwest: "South West", "south west": "South West",
};

function canonicalFromRaw(raw: unknown): string {
  if (typeof raw !== "string") return "";
  // Lowercase, turn any run of non-letters into a single space ("north-west" →
  // "north west"), then trim. Handles "North_East", "South / West", etc.
  const key = raw.toLowerCase().replace(/[^a-z]+/g, " ").trim();
  if (!key) return "";
  if (CANONICAL[key]) return CANONICAL[key];
  // Retry with spaces removed ("south east" → "southeast") to catch the compact forms.
  return CANONICAL[key.replace(/\s+/g, "")] ?? "";
}

/** Resolve a listing's facing: DirectionFaces (houses) first, then Exposure (condos). */
export function normalizeDirectionFaces(
  payload: Record<string, unknown> | null | undefined
): string {
  if (!payload) return "";
  return canonicalFromRaw(payload.DirectionFaces) || canonicalFromRaw(payload.Exposure);
}
