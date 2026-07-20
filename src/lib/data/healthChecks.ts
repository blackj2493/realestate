/**
 * Pure evaluation logic for the data-health canary (scripts/worker/dataHealthCheck.ts).
 *
 * Separated from the script so the rules can be unit-tested by REPLAYING each historical
 * silent failure. A monitor nobody has watched fail is not evidence of anything — the tests
 * in healthChecks.test.ts feed the exact shapes the July 2026 bugs produced and assert each
 * one is caught.
 *
 * No IO here: the script fetches, this decides.
 */
import type { MarketRow } from "@/lib/data/marketBoard";
import type { CondoAreaRow } from "@/lib/data/condoFeeBoard";
import { TREND_MAX_ANNUAL_PCT } from "@/lib/condo/feeStability";

export type Severity = "error" | "warn" | "info";

export interface Problem {
  severity: Severity;
  check: string;
  detail: string;
}

/**
 * Cells that are legitimately unavailable, keyed `Market:metric`, with WHY.
 *
 * Everything here is a structural feed limitation, not a bug — but each is a real gap a
 * reader sees as "—", so it stays visible and reviewed rather than forgotten. Remove an
 * entry the moment its cause is fixed; resolved gaps are reported so this list can't rot.
 */
export const KNOWN_GAPS: Record<string, string> = {
  "Ottawa:sellThroughPct":
    "raw_vow_delisted has no CountyOrParish and files Ottawa under OREB area names (Barrhaven, Kanata, …), so region_listing_outcomes matches 0 failed listings. Fix = region_aliases mapping.",
  "Ottawa:rentalRows":
    "rental_market_index keys Ottawa by OREB area name rather than a single \"Ottawa\" city key, so region_rental_yield rolls up nothing. Fix = region_aliases mapping.",
};

/** Plausible bounds for each headline metric. Outside ⇒ something is structurally wrong. */
export const RANGES: Record<string, { min: number; max: number; label: string }> = {
  medianPrice: { min: 200_000, max: 5_000_000, label: "median sold price" },
  avgPrice: { min: 200_000, max: 8_000_000, label: "average sold price" },
  activeCount: { min: 20, max: 100_000, label: "active listings" },
  monthsOfSupply: { min: 0.3, max: 30, label: "months of supply" },
  soldToListPct: { min: 80, max: 130, label: "sold-to-list %" },
  trueDom: { min: 1, max: 400, label: "true days on market" },
  soldMedianDom: { min: 1, max: 200, label: "median days to sell" },
  cutSharePct: { min: 0, max: 70, label: "% cutting price" },
  // Upper bound is deliberately < 100: an exact 100% sell-through is the signature of the
  // Ottawa "0 failed listings" bug, not a real market.
  sellThroughPct: { min: 5, max: 99.5, label: "sell-through %" },
};

/** Metrics every market must have. Null here without a KNOWN_GAPS entry is an error. */
export const REQUIRED: (keyof MarketRow)[] = [
  "medianPrice",
  "avgPrice",
  "activeCount",
  "monthsOfSupply",
  "soldToListPct",
  "trueDom",
  "soldMedianDom",
  "cutShare",
  "temperature",
  "sellThroughPct",
];

export interface MarketCheckInput {
  rows: MarketRow[];
  expectedMarkets: string[];
  dataAsOf: string | null;
  staleHours: number;
  /** Injectable for deterministic tests. */
  now?: number;
  knownGaps?: Record<string, string>;
}

const hoursSince = (iso: string | null, now: number): number | null => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : (now - t) / 3_600_000;
};

/** Coverage, freshness, completeness (vs KNOWN_GAPS) and plausibility of market metrics. */
export function checkMarketRows(input: MarketCheckInput): Problem[] {
  const { rows, expectedMarkets, dataAsOf, staleHours } = input;
  const now = input.now ?? Date.now();
  const gaps = input.knownGaps ?? KNOWN_GAPS;
  const out: Problem[] = [];
  const add = (severity: Severity, check: string, detail: string) =>
    out.push({ severity, check, detail });

  const byRegion = new Map(rows.map((r) => [r.region, r]));

  // Coverage — a market vanishing entirely is the loudest possible signal.
  const missing = expectedMarkets.filter((m) => !byRegion.has(m));
  if (missing.length) {
    add("error", "coverage", `region_metrics is missing ${missing.length} market(s): ${missing.join(", ")}`);
  }

  // Freshness — a frozen precompute serves plausible-but-stale numbers indefinitely.
  const age = hoursSince(dataAsOf, now);
  if (age == null) {
    add("error", "freshness", "region_metrics has no computed_at timestamp");
  } else if (age > staleHours) {
    add(
      "error",
      "freshness",
      `region_metrics is ${age.toFixed(1)}h old (limit ${staleHours}h) — the nightly refresh is not landing`
    );
  }

  const seenGaps = new Set<string>();
  for (const region of expectedMarkets) {
    const row = byRegion.get(region);
    if (!row) continue;

    for (const metric of REQUIRED) {
      const key = `${region}:${metric}`;
      if (row[metric] == null) {
        if (gaps[key]) seenGaps.add(key);
        else add("error", "completeness", `${region}: ${String(metric)} is null (not a known gap)`);
      } else if (gaps[key]) {
        seenGaps.add(key);
        add("info", "gap-resolved", `${region}: ${String(metric)} now has data — remove it from KNOWN_GAPS`);
      }
    }

    // rentalRows is an array, so it needs its own emptiness test.
    const rentalKey = `${region}:rentalRows`;
    if (row.rentalRows.length === 0) {
      if (gaps[rentalKey]) seenGaps.add(rentalKey);
      else add("error", "completeness", `${region}: no rental yield rows (not a known gap)`);
    } else if (gaps[rentalKey]) {
      seenGaps.add(rentalKey);
      add("info", "gap-resolved", `${region}: rental yield now has data — remove it from KNOWN_GAPS`);
    }

    const values: Record<string, number | null> = {
      medianPrice: row.medianPrice,
      avgPrice: row.avgPrice,
      activeCount: row.activeCount,
      monthsOfSupply: row.monthsOfSupply,
      soldToListPct: row.soldToListPct,
      trueDom: row.trueDom,
      soldMedianDom: row.soldMedianDom,
      cutSharePct: row.cutShare == null ? null : row.cutShare * 100,
      sellThroughPct: row.sellThroughPct,
    };
    for (const [metric, v] of Object.entries(values)) {
      const r = RANGES[metric];
      if (!r || v == null) continue;
      if (v < r.min || v > r.max) {
        add("error", "range", `${region}: ${r.label} = ${v} is outside the plausible range ${r.min}–${r.max}`);
      }
    }

    if (row.medianPrice != null && row.avgPrice != null && row.medianPrice > row.avgPrice * 1.2) {
      add("warn", "sanity", `${region}: median (${row.medianPrice}) far exceeds average (${row.avgPrice})`);
    }
  }

  // A gap whose market disappeared would otherwise hide here forever.
  for (const key of Object.keys(gaps)) {
    if (!seenGaps.has(key)) {
      add(
        "warn",
        "stale-allowlist",
        `KNOWN_GAPS entry "${key}" was never evaluated — the market or metric may have been renamed`
      );
    }
  }
  return out;
}

export interface CondoCheckInput {
  rows: CondoAreaRow[];
  dataAsOf: string | null;
  staleDays: number;
  /** Cohorts found beyond the estimator clamp (stale-row signature). */
  clampViolations: { cohort_type: string; cohort_key: string; pct: number }[];
  now?: number;
}

/** Condo cohort coverage, freshness and clamp violations. */
export function checkCondoRows(input: CondoCheckInput): Problem[] {
  const { rows, dataAsOf, staleDays, clampViolations } = input;
  const now = input.now ?? Date.now();
  const out: Problem[] = [];
  const add = (severity: Severity, check: string, detail: string) =>
    out.push({ severity, check, detail });

  if (rows.length === 0) {
    add("error", "condo-coverage", "no area_trend cohorts — the condo-fee tracker renders empty");
    return out;
  }
  const age = hoursSince(dataAsOf, now);
  if (age != null && age > staleDays * 24) {
    add("error", "condo-freshness", `condo_fee_stats is ${(age / 24).toFixed(1)}d old (limit ${staleDays}d)`);
  }
  if (clampViolations.length) {
    const sample = clampViolations
      .slice(0, 5)
      .map((v) => `${v.cohort_type}/${v.cohort_key}=${v.pct}%`)
      .join(", ");
    add(
      "error",
      "condo-clamp",
      `${clampViolations.length}+ condo cohort(s) exceed ±${TREND_MAX_ANNUAL_PCT}%/yr (stale rows are accumulating): ${sample}`
    );
  }
  return out;
}

/** Repo migration files not recorded as applied — the migration-082 failure mode. */
export function checkMigrationLedger(files: string[], applied: string[]): Problem[] {
  const out: Problem[] = [];
  if (applied.length === 0) {
    return [
      {
        severity: "warn",
        check: "migrations",
        detail: "schema_migrations is empty — run `npx tsx scripts/admin/applyMigrationFiles.ts --baseline` once",
      },
    ];
  }
  const set = new Set(applied);
  const unapplied = files.filter((f) => !set.has(f));
  if (unapplied.length) {
    out.push({
      severity: "error",
      check: "migrations",
      detail: `${unapplied.length} migration file(s) are not recorded as applied: ${unapplied.join(", ")}`,
    });
  }
  return out;
}
