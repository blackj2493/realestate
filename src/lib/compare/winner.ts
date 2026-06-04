/** Winner-highlighting helpers for the Compare grid. Pure + deterministic. */

export type WinnerDirection = "high" | "low" | null;

const finite = (v: number | null | undefined): v is number =>
  typeof v === "number" && Number.isFinite(v);

/**
 * Indices of the winning column(s). Empty unless ≥2 columns have a finite value,
 * so a winner is never crowned on missing/locked data. Ties return every winner.
 */
export function winnerIndices(
  values: (number | null | undefined)[],
  dir: WinnerDirection
): Set<number> {
  if (!dir) return new Set();
  const valid = values
    .map((v, i) => ({ v, i }))
    .filter((x): x is { v: number; i: number } => finite(x.v));
  if (valid.length < 2) return new Set();
  const best = dir === "high"
    ? Math.max(...valid.map((x) => x.v))
    : Math.min(...valid.map((x) => x.v));
  return new Set(valid.filter((x) => x.v === best).map((x) => x.i));
}

/** The winning numeric value (for magnitude/gap deltas), or null. */
export function bestValue(
  values: (number | null | undefined)[],
  dir: WinnerDirection
): number | null {
  if (!dir) return null;
  const valid = values.filter(finite);
  if (valid.length < 2) return null;
  return dir === "high" ? Math.max(...valid) : Math.min(...valid);
}
