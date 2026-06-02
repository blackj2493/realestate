/**
 * Canonical number/currency/percent formatting (design-system spec §7, §10.6).
 *
 * This is the single source of truth for formatting numeric data. New and
 * migrated UI should import from here. Existing scattered helpers
 * (`formatPrice` in lib/utils.ts, inline `compactPrice` / `formatPct`) will be
 * migrated to these over time — output here intentionally mirrors them so the
 * swap is byte-identical.
 *
 * All money is CAD in the en-CA locale. Pair every numeric render with the
 * `font-mono tabular-nums` classes so columns align.
 */

const cad0 = new Intl.NumberFormat("en-CA", {
  style: "currency",
  currency: "CAD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const cad2 = new Intl.NumberFormat("en-CA", {
  style: "currency",
  currency: "CAD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Whole-dollar CAD, e.g. `$4,627`. Mirrors lib/utils.ts `formatPrice`. */
export function fmtCurrency(value: number): string {
  return cad0.format(value);
}

/** CAD with cents, e.g. `$4,627.34`. For detail views / sub-dollar precision. */
export function fmtCurrencyDetail(value: number): string {
  return cad2.format(value);
}

/** Percentage with fixed decimals, e.g. `4.7%`. Defaults to 1 decimal. */
export function fmtPercent(value: number, decimals = 1): string {
  return `${value.toFixed(decimals)}%`;
}

/**
 * Compact price for dense lists/tiles, e.g. `$1.2M`, `$320K`, `$847`.
 * Mirrors the inline `compactPrice` in WatchlistSummary.tsx so it is a
 * drop-in replacement.
 */
export function fmtCompact(value: number): string {
  if (value >= 1_000_000) return `$${(Math.round((value / 1_000_000) * 100) / 100).toString()}M`;
  if (value >= 1_000) return `$${Math.round(value / 1000)}K`;
  return `$${Math.round(value)}`;
}
