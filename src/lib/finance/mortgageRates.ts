/**
 * Mortgage-rate constants + pure helpers for the listing calculator.
 *
 * Two kinds of rate live here, and they are NOT the same thing:
 *
 *  1. The QUALIFYING (stress-test) constants — the OSFI B-20 minimum qualifying
 *     rate: `max(contract + 2%, 5.25% floor)`. The 5.25% floor and the 2% buffer
 *     are regulator-set and change rarely, so they are dated constants here (not
 *     fetched). Used by `affordability.ts`.
 *
 *  2. The CONTRACT rate seed — the "typical 5-yr fixed" the calculator starts on.
 *     This drifts with the market, so it is refreshed monthly from the Bank of
 *     Canada Valet API (scripts/admin/refresh-mortgage-rate.ts) into the
 *     `market_rates` table and read via `getMortgageRate.ts`. The constant below
 *     is only the FALLBACK when that row is missing/stale/out-of-bounds.
 *
 * ⚠️  LAST VERIFIED: 2026-07-20. Re-check the OSFI floor + the Valet series/offset
 * against source before relying on these. Compliance: public rate data, no LLM.
 */

// ── Stress-test (qualifying) constants — OSFI B-20 ──────────────────────────
/** Minimum qualifying-rate floor. OSFI set 5.25% effective 2021-06-01.
 *  Source: https://www.osfi-bsif.gc.ca/ (Residential Mortgage Underwriting, B-20). */
export const MORTGAGE_STRESS_TEST_FLOOR_PCT = 5.25;
/** Buffer added to the contract rate; the higher of this vs the floor qualifies. */
export const STRESS_TEST_BUFFER_PCT = 2.0;

// ── Debt-service ratio limits (CMHC insured) ────────────────────────────────
/** Gross Debt Service limit — housing costs ÷ gross income. */
export const GDS_LIMIT_RATIO = 0.39;
/** Total Debt Service limit — (housing + other debts) ÷ gross income. */
export const TDS_LIMIT_RATIO = 0.44;
/** Monthly heating cost included in GDS/TDS when the listing has no figure. */
export const QUALIFY_MONTHLY_HEAT = 100;
/** Share of condo fees counted toward debt service (lenders use 50%). */
export const QUALIFY_CONDO_FEE_FACTOR = 0.5;

// ── Contract-rate seed: source, fallback, and guards ────────────────────────
/** The `market_rates.key` the 5-yr fixed lives under. */
export const MORTGAGE_RATE_KEY = "five_year_fixed";
/** Fallback seed when the live row is missing/stale/invalid (dated — review). */
export const DEFAULT_MORTGAGE_RATE_PCT = 5.5;
/** Sanity band — a fetched or stored rate outside this is rejected, never shown. */
export const MORTGAGE_RATE_BOUNDS = { minPct: 1, maxPct: 15 } as const;
/** Past this age the stored rate is flagged stale (reader keeps serving it + alerts). */
export const MORTGAGE_RATE_MAX_STALE_DAYS = 45;

/**
 * Bank of Canada Valet observation series for the 5-year conventional mortgage
 * (posted). ⚠️ Verify the exact code in the Valet series directory
 * (https://www.bankofcanada.ca/valet/lists/series) before the first live run.
 */
export const BOC_VALET_SERIES = "V80691335";
/**
 * BoC publishes a POSTED rate; buyers actually get a discounted rate ~1–2% lower.
 * This offset trues the posted figure down to a typical street rate. Tune it on
 * the first `--apply`-less dry run (the job prints posted vs resolved).
 */
export const POSTED_TO_STREET_DISCOUNT_PCT = 1.5;

// ── Pure helpers (unit-tested) ──────────────────────────────────────────────

/** A finite rate inside the sanity band, else null. Guards both fetch + read. */
export function sanitizeRatePct(raw: number): number | null {
  if (!Number.isFinite(raw)) return null;
  if (raw < MORTGAGE_RATE_BOUNDS.minPct || raw > MORTGAGE_RATE_BOUNDS.maxPct) return null;
  return Math.round(raw * 1000) / 1000;
}

/** Posted → typical street rate: posted minus the discount, floored at 0. */
export function resolveStreetRate(postedPct: number, discountPct: number): number {
  return Math.max(0, postedPct - discountPct);
}

/** Whole days between `asOf` and `now`, or null if `asOf` is unparseable. */
export function daysSince(asOf: string | Date | null, now: Date = new Date()): number | null {
  if (!asOf) return null;
  const t = asOf instanceof Date ? asOf.getTime() : Date.parse(asOf);
  if (!Number.isFinite(t)) return null;
  return Math.floor((now.getTime() - t) / 86_400_000);
}

/** True when `asOf` is older than `maxDays` (or unparseable — treat as stale). */
export function isRateStale(asOf: string | Date | null, maxDays: number, now: Date = new Date()): boolean {
  const d = daysSince(asOf, now);
  return d === null || d > maxDays;
}

/**
 * Pull the latest observation for `series` from a Bank of Canada Valet
 * `/observations` payload. Returns the value (as a percent) and its date, or
 * null if the shape is missing/empty.
 */
export function parseValetLatest(
  raw: unknown,
  series: string
): { valuePct: number; date: string } | null {
  const obs = (raw as { observations?: unknown })?.observations;
  if (!Array.isArray(obs) || obs.length === 0) return null;
  const last = obs[obs.length - 1] as Record<string, unknown>;
  const cell = last?.[series] as { v?: unknown } | undefined;
  const valuePct = Number(cell?.v);
  const date = String(last?.d ?? "");
  if (!Number.isFinite(valuePct) || !date) return null;
  return { valuePct, date };
}
