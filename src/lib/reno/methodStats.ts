// src/lib/reno/methodStats.ts
//
// The credibility line-up under the headline number: what the estimate was actually
// built from, in the engine's OWN measurements.
//
// The intent is trust, not tutorial. Each row is a real diagnostic the model already
// produced (cohort sample, fit, effective sample after weighting, the width of the
// predictive band) — enough for a technical reader to see this is fitted rather than
// guessed, while saying nothing about how the anchor, the shrinkage or the coefficients
// work. Rows self-omit when their figure is unavailable, so nothing is ever invented.
//
// Pure + deterministic (CLAUDE.md §4).

export interface MethodRow {
  label: string;
  value: string;
  /** Longer gloss shown under the value on wide layouts. */
  note?: string;
}

export interface MethodStatsInput {
  /** Cohort R², 0..1. */
  r2Score?: number | null;
  /** Raw comparable sales consulted. */
  comps?: number | null;
  /** Effective sample after recency + robustness weighting (Kish). */
  nEff?: number | null;
  /** Model confidence tier the engine assigned. */
  confidence?: 'HIGH' | 'MEDIUM' | 'LOW' | null;
  /** The estimate and its predictive band, for the band-width row. */
  estimatedValue?: number | null;
  lowBand?: number | null;
  highBand?: number | null;
}

/** Half-width of the predictive band as a % of the estimate — null unless all three exist. */
export function bandPct(input: MethodStatsInput): number | null {
  const { estimatedValue: v, lowBand: lo, highBand: hi } = input;
  if (!v || v <= 0 || !lo || !hi || hi <= lo) return null;
  return ((hi - lo) / 2 / v) * 100;
}

/**
 * The rows to render. Order is deliberate: how much of the sample really counted → how
 * well the model fits → how honest the range is → how fresh the data is. The raw sample
 * SIZE is deliberately absent: the hero states it, and this panel qualifies it.
 */
export function buildMethodRows(input: MethodStatsInput): MethodRow[] {
  const rows: MethodRow[] = [];

  // Only the EFFECTIVE sample lives here — the raw comparable count is stated in the
  // hero's evidence line, and repeating it would say one fact in two places.
  if (
    typeof input.comps === 'number' &&
    input.comps > 0 &&
    typeof input.nEff === 'number' &&
    input.nEff > 0
  ) {
    rows.push({
      label: 'Effective sample',
      value: `${Math.round(input.nEff)} of ${input.comps}`,
      note: 'Recent and similar sales count for more; outliers count for less.',
    });
  }

  if (typeof input.r2Score === 'number' && input.r2Score > 0) {
    const conf = input.confidence ? ` · ${input.confidence.toLowerCase()} confidence` : '';
    rows.push({
      label: 'Model fit',
      value: `R² ${input.r2Score.toFixed(2)}${conf}`,
      note: 'Measured on this community and property type — not a city-wide average.',
    });
  }

  const band = bandPct(input);
  if (band != null) {
    rows.push({
      label: 'Range shown',
      value: `±${band.toFixed(1)}%`,
      note: 'A one-standard-deviation predictive band, not a padded spread.',
    });
  }

  rows.push({
    label: 'Data',
    value: 'Closed sales, refreshed every 24h',
    note: 'Board feed (TRREB VOW) — closes, not asking prices.',
  });

  return rows;
}
