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
  // Empty by design. Both original entries (Ottawa sell-through and Ottawa rental yield)
  // were closed by the region_aliases mapping in migration 088 — the canary reported them
  // as "gap-resolved", which is exactly the signal this list exists to produce.
  //
  // Add an entry here ONLY for a gap that is a genuine structural feed limitation, always
  // with the reason and the fix, e.g.:
  //   'Region:metric': 'why the feed cannot supply this, and what would fix it',
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

/* ── Drift detection ─────────────────────────────────────────────────────────────────
   The checks above catch metrics that go null, stale, out-of-range or unapplied. They
   cannot catch the remaining class: WRONG BUT PLAUSIBLE — a subtly bad formula, a join
   that silently widens, a filter that stops filtering. Those sit inside every range and
   look normal in isolation.

   What exposes them is MOVEMENT. region_metrics is recomputed nightly from trailing
   windows, so a healthy market barely moves overnight; a large single-night jump is a
   code/data event, not a market event. */

export interface SnapshotEntry {
  region: string;
  metric: string;
  value: number | null;
}

/** Pseudo-metric recording which month the price figures describe (YYYYMM as a number). */
export const LATEST_MONTH_KEY = "latestMonthKey";

interface DriftRule {
  metric: string;
  label: string;
  /** Compare absolute difference instead of % change (for metrics that live near 100). */
  absolute?: boolean;
  warn: number;
  error: number;
  /**
   * Metric describes the LATEST month, which is legitimately volatile in its first days
   * (few sales). Compared only when the month has not rolled over.
   */
  monthSensitive?: boolean;
}

/**
 * Thresholds are deliberately generous: this is a tripwire for structural breakage, not a
 * market-movement alert. Anything firing here should be investigated as a bug first.
 */
export const DRIFT_RULES: DriftRule[] = [
  { metric: "medianPrice", label: "median sold price", warn: 10, error: 25, monthSensitive: true },
  { metric: "avgPrice", label: "average sold price", warn: 12, error: 30, monthSensitive: true },
  { metric: "activeCount", label: "active listings", warn: 12, error: 30 },
  { metric: "monthsOfSupply", label: "months of supply", warn: 25, error: 50 },
  { metric: "soldToListPct", label: "sold-to-list %", absolute: true, warn: 2, error: 5 },
  { metric: "trueDom", label: "true days on market", warn: 20, error: 45 },
  { metric: "soldMedianDom", label: "median days to sell", warn: 25, error: 50 },
  { metric: "cutSharePct", label: "% cutting price", absolute: true, warn: 6, error: 15 },
  { metric: "sellThroughPct", label: "sell-through %", absolute: true, warn: 8, error: 20 },
];

/** Flatten board rows into snapshot entries (including the month key). */
export function snapshotFromRows(rows: MarketRow[]): SnapshotEntry[] {
  const out: SnapshotEntry[] = [];
  for (const r of rows) {
    const push = (metric: string, value: number | null) => out.push({ region: r.region, metric, value });
    push("medianPrice", r.medianPrice);
    push("avgPrice", r.avgPrice);
    push("activeCount", r.activeCount);
    push("monthsOfSupply", r.monthsOfSupply);
    push("soldToListPct", r.soldToListPct);
    push("trueDom", r.trueDom);
    push("soldMedianDom", r.soldMedianDom);
    push("cutSharePct", r.cutShare == null ? null : Math.round(r.cutShare * 1000) / 10);
    push("sellThroughPct", r.sellThroughPct);
    // "2026-06" → 202606, so a month rollover is detectable without a text column.
    const last = r.priceSeries.length ? r.priceSeries[r.priceSeries.length - 1].month : null;
    push(LATEST_MONTH_KEY, last ? Number(last.replace("-", "")) : null);
  }
  return out;
}

const keyOf = (e: { region: string; metric: string }) => `${e.region}:${e.metric}`;

/**
 * Compare last night's snapshot with tonight's. Returns one problem per metric that moved
 * more than its threshold. A metric that appears or disappears is already covered by the
 * completeness check, so it is skipped here rather than double-reported.
 */
export function checkDrift(prev: SnapshotEntry[], curr: SnapshotEntry[]): Problem[] {
  const out: Problem[] = [];
  if (prev.length === 0) return out; // first run — nothing to compare against

  const pv = new Map(prev.map((e) => [keyOf(e), e.value]));
  const cv = new Map(curr.map((e) => [keyOf(e), e.value]));
  const regions = Array.from(new Set(curr.map((e) => e.region)));

  for (const region of regions) {
    const monthChanged =
      pv.get(`${region}:${LATEST_MONTH_KEY}`) !== cv.get(`${region}:${LATEST_MONTH_KEY}`);

    for (const rule of DRIFT_RULES) {
      if (rule.monthSensitive && monthChanged) continue; // legitimately volatile — see DRIFT_RULES
      const before = pv.get(`${region}:${rule.metric}`);
      const after = cv.get(`${region}:${rule.metric}`);
      if (before == null || after == null) continue; // null transitions → completeness check
      if (before === 0) continue; // no meaningful relative change from zero

      const delta = rule.absolute
        ? Math.abs(after - before)
        : Math.abs((after - before) / before) * 100;
      if (delta < rule.warn) continue;

      const unit = rule.absolute ? "pts" : "%";
      const detail =
        `${region}: ${rule.label} moved ${delta.toFixed(1)}${unit} overnight ` +
        `(${before} → ${after}) — nightly recomputes should barely move; investigate as a bug first`;
      out.push({ severity: delta >= rule.error ? "error" : "warn", check: "drift", detail });
    }
  }
  return out;
}

/**
 * The price-events capture going dark — the "zero rows EVER" failure mode (2026-07-22):
 * the nightly capture step existed only in the abandoned Railway orchestrator, so
 * price_events sat empty for a week with nothing watching. price_events itself only grows
 * when a price actually changes, so the liveness signal is listing_price_state: the capture
 * job seeds/updates state rows every run (~5.5k listings/day churn guarantees movement),
 * making its newest updated_at a reliable heartbeat for the whole pipeline.
 */
export function checkPriceLedger(input: {
  /** max(listing_price_state.updated_at), or null when the table is empty. */
  stateNewest: string | null;
  staleHours: number;
  now?: number;
}): Problem[] {
  const now = input.now ?? Date.now();
  if (!input.stateNewest) {
    return [
      {
        severity: "error",
        check: "price-ledger",
        detail:
          "listing_price_state is empty — capture-price-events has never run (price_events is not accruing)",
      },
    ];
  }
  const age = hoursSince(input.stateNewest, now);
  if (age == null) {
    return [
      { severity: "error", check: "price-ledger", detail: "listing_price_state.updated_at is unreadable" },
    ];
  }
  if (age > input.staleHours) {
    return [
      {
        severity: "error",
        check: "price-ledger",
        detail: `listing_price_state is ${age.toFixed(1)}h old (limit ${input.staleHours}h) — the nightly price-events capture is not landing`,
      },
    ];
  }
  return [];
}

/**
 * Transactional email failures (email_send_failures, migration 098). Exists because the
 * welcome email silently failed for weeks when Vercel's Resend key was wrong — recording a
 * row per miss and alerting here (from GitHub Actions, a channel that works even when the
 * Vercel Resend credential is dead) is what turns that silence into a same-day signal.
 *
 * A `missing_key` is the loudest tell — the web runtime has no key at all.
 */
export function checkEmailFailures(failures: { kind: string; reason: string }[]): Problem[] {
  if (failures.length === 0) return [];
  const byKind = new Map<string, number>();
  let missingKey = 0;
  for (const f of failures) {
    if (f.reason === "missing_key") missingKey++;
    byKind.set(f.kind, (byKind.get(f.kind) ?? 0) + 1);
  }
  const breakdown = [...byKind.entries()].map(([k, n]) => `${k}×${n}`).join(", ");
  const detail =
    `${failures.length} transactional email send(s) failed recently (${breakdown})` +
    (missingKey > 0
      ? ` — ${missingKey} were 'missing_key' (RESEND_API_KEY absent from the web runtime — check Vercel env + redeploy)`
      : " — check the Resend key value/status");
  return [{ severity: "error", check: "email-delivery", detail }];
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
