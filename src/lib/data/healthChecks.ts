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
 * The PureProperty Estimate (property_estimates) silently drifting stale against a moving list
 * price. The AVM deliberately does NOT use list price as a feature, so a price change should
 * not move the stored estimate — but the surfaces that read this precompute (Compare, the
 * Command-Center "Estimated Sale Price" batch) render it AGAINST the current list price, so a
 * stale row shows a wrong gap once the doc/Typesense side carries the new price. The refresh
 * that keeps it current is `continue-on-error` with a 30-min timeout (daily-sync.yml) and the
 * table has no is_stale/model_version/price-snapshot column, so both failure modes below are
 * otherwise invisible — this was previously the one precompute the canary did not watch.
 *
 *  1. HEARTBEAT — the nightly delta re-estimates every re-synced listing (~5.5k/day churn), so
 *     max(computed_at) must advance nightly. A stale newest timestamp ⇒ the refresh stopped
 *     landing entirely (the whole step timed out or was dropped).
 *
 *  2. BACKLOG — the nastier partial case: the step bumps a few rows then times out, so the
 *     heartbeat still looks fresh while thousands keep a days-old estimate. Every active row is
 *     re-based by the twice-weekly full recompute (≤ ~4-day cycle), so ANY active estimate older
 *     than `staleMaxHours` (set above that cycle) has definitively missed both the recompute and
 *     any interim re-estimate — a growing count of them is a chronic/partial under-run.
 */
export function checkEstimateFreshness(input: {
  /** max(property_estimates.computed_at), or null when the table is empty. */
  estimateNewest: string | null;
  /** Active estimate rows whose computed_at is older than `staleMaxHours`. */
  staleCount: number;
  /** Total active estimate rows (for the share in the message). */
  totalCount: number;
  /** Heartbeat: max(computed_at) must advance within this window (nightly delta). */
  staleHours: number;
  /** A row older than this is stale — set ABOVE the twice-weekly full-recompute cycle. */
  staleMaxHours: number;
  /** Tolerate this many straggling stale rows before erroring (a few always straddle a run). */
  staleTolerance: number;
  now?: number;
}): Problem[] {
  const now = input.now ?? Date.now();

  if (!input.estimateNewest) {
    return [
      {
        severity: "error",
        check: "estimate-freshness",
        detail:
          "property_estimates is empty — refresh-property-estimates has never run (Compare & the Command-Center batch have no estimate to show)",
      },
    ];
  }

  const out: Problem[] = [];

  const age = hoursSince(input.estimateNewest, now);
  if (age == null) {
    out.push({ severity: "error", check: "estimate-freshness", detail: "property_estimates.computed_at is unreadable" });
    return out;
  }
  if (age > input.staleHours) {
    out.push({
      severity: "error",
      check: "estimate-freshness",
      detail: `property_estimates is ${age.toFixed(1)}h old (limit ${input.staleHours}h) — the nightly estimate refresh is not landing`,
    });
  }

  if (input.staleCount > input.staleTolerance) {
    const pct = input.totalCount > 0 ? ((input.staleCount / input.totalCount) * 100).toFixed(1) : "?";
    out.push({
      severity: "error",
      check: "estimate-staleness",
      detail:
        `${input.staleCount} of ${input.totalCount} active estimates (${pct}%) are older than ${input.staleMaxHours}h ` +
        `(tolerance ${input.staleTolerance}) — the estimate refresh/recompute is under-running, so those listings show a stale ` +
        `"Estimated Sale Price" on Compare & the Command-Center batch even after a price change`,
    });
  }

  return out;
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

/**
 * The media-reconciliation sweep silently doing nothing — the failure this check exists for.
 *
 * From at least 2026-06-30 to 2026-08-03, reconcileMissingMedia recovered ZERO listings every
 * night while the sync run stayed green. Its page query timed out (a planner mis-estimate sent
 * it to a 42.7 s seq scan against an 8 s statement_timeout — see migration 108), the sweep
 * caught the error exactly as designed, logged a non-fatal warning, and reported success.
 * 10,751 active listings sat with a blank gallery and nothing surfaced it.
 *
 * The trap is that "scanned 0" is AMBIGUOUS: it is the correct, healthy answer when there is
 * no work to do, and the signature of total failure when there is. So the rule is a JOIN of
 * two facts the sweep alone cannot see — its own outcome, and whether work was outstanding:
 *
 *   status='failed'                        → error, unconditionally (the sweep knows it broke)
 *   emptyMedia > tolerance AND scanned = 0 → error (work was waiting and nothing was looked at)
 *   sweep row missing / stale              → warn  (the job stopped running at all)
 *
 * Deliberately NOT alerting on "emptyMedia is large" by itself: a legitimate bulk insert
 * (backfill-missing-actives.ts adds ~10k photo-less rows in one run) makes that number spike
 * for perfectly healthy reasons. What must never happen is the number being large while the
 * sweep reports having looked at nothing.
 */
export function checkMediaReconcile(input: {
  emptyMedia: number;
  sweeps: { id: string; scanned: number | null; status: string | null; updatedAt: string | null }[];
  nowMs: number;
  /** Empty-media rows tolerated before "scanned 0" is treated as a failure. */
  tolerance?: number;
  /** Hours before a sweep row is considered stale (default 36 — one missed night is fine). */
  staleHours?: number;
}): Problem[] {
  const out: Problem[] = [];
  const tolerance = input.tolerance ?? 100;
  const staleHours = input.staleHours ?? 36;

  if (input.sweeps.length === 0) {
    return [
      {
        severity: "warn",
        check: "media-reconcile",
        detail:
          "no media-reconcile sweep rows in sync_state — the nightly sweep has never recorded an outcome " +
          "(is migration 107 applied, and has daily-sync run since?)",
      },
    ];
  }

  const totalScanned = input.sweeps.reduce((n, s) => n + (s.scanned ?? 0), 0);

  for (const s of input.sweeps) {
    if (s.status === "failed") {
      out.push({
        severity: "error",
        check: "media-reconcile",
        detail:
          `media sweep '${s.id}' recorded status=failed (scanned ${s.scanned ?? 0}) — its page query is erroring. ` +
          "Check the plan first: idx_listings_empty_media (migration 108) must still match the .or() filter in sweepMissingMedia.",
      });
    }
    const ageH = s.updatedAt ? (input.nowMs - new Date(s.updatedAt).getTime()) / 3_600_000 : null;
    if (ageH === null || ageH > staleHours) {
      out.push({
        severity: "warn",
        check: "media-reconcile",
        detail:
          `media sweep '${s.id}' last recorded an outcome ` +
          (ageH === null ? "never" : `${ageH.toFixed(0)}h ago`) +
          ` (>${staleHours}h) — the nightly reconcile step may have stopped running`,
      });
    }
  }

  if (input.emptyMedia > tolerance && totalScanned === 0) {
    out.push({
      severity: "error",
      check: "media-reconcile",
      detail:
        `${input.emptyMedia} active listings have no photos but the media sweeps scanned 0 rows — ` +
        "the reconcile is not doing any work. This is the 2026-06/07 silent-timeout signature (migration 108).",
    });
  }

  return out;
}

/** Minimum live active inventory the onboarding example region must resolve to. Woodbridge
 *  sits at ~266; 25 clears normal fluctuation but catches a break to ~0 (a CityRegion rename
 *  that silences the COMMUNITY_ALIASES expansion), which would ship a 0/0 intro email. */
export const ONBOARDING_EXAMPLE_MIN_ACTIVE = 25;

/**
 * The onboarding email's example dashboard (2B) is built from a HARDCODED region name
 * (EXAMPLE_REGION = "Woodbridge"). "Woodbridge" is not a raw TRREB facet value — it resolves
 * only through the COMMUNITY_ALIASES expansion (→ East + West Woodbridge). If TRREB ever
 * renames those CityRegions, the alias silently yields 0 and the intro email shows "0 new /
 * 0 for sale" (the exact bug this replays). The email itself falls back to a whole city so a
 * user never sees the 0 — which is precisely why this WARN exists: without it the primary
 * example could rot to the fallback unnoticed. Warn, not error: the fallback protects the
 * user, so this is "fix the alias soon", not "page now".
 */
export function checkOnboardingExample(input: {
  region: string;
  activeCount: number | null;
  minActive?: number;
}): Problem[] {
  const min = input.minActive ?? ONBOARDING_EXAMPLE_MIN_ACTIVE;
  if (input.activeCount == null || input.activeCount < min) {
    return [
      {
        severity: "warn",
        check: "onboarding-example",
        detail:
          `onboarding example region "${input.region}" resolves to ` +
          `${input.activeCount ?? "null"} active listings (< ${min}) — the CityRegion alias ` +
          "(COMMUNITY_ALIASES in area.ts) may have drifted from TRREB's facet values. The email " +
          "falls back to a whole city so users don't see a 0, but fix the alias.",
      },
    ];
  }
  return [];
}

/**
 * Stale-unpriceable invariant: an ACTIVE listing of a type the AVM refuses to price
 * (isUnpriceableType — Vacant Land, Farm, commercial-class, …) must NEVER carry
 * estimated_value > 0 in property_estimates.
 *
 * Replays the 2026-08-12 finding: refresh-property-estimates.ts skipped listings whose
 * recompute produced nothing (no estimate AND no GLA), preserving whatever the table
 * already held — 1,346 land/commercial listings kept dwelling-model values frozen in
 * May through 12+ full recomputes, and after #319 those values were feeding Deal Score
 * grades on vacant land. The script now clears such rows; this check catches the class
 * (ANY writer leaving a value where the model refuses to price) rather than the instance.
 *
 * Error, not warn: a nonzero count is wrong data live on listing pages today, and the
 * fix is mechanical (re-run the full recompute, which clears the rows).
 */
export function checkUnpriceableValues(input: {
  count: number | null;
  error?: string | null;
}): Problem[] {
  if (input.error || input.count === null) {
    return [
      {
        severity: "warn",
        check: "unpriceable-values",
        detail:
          `unpriceable-value count unavailable (${input.error ?? "null count"}) — ` +
          "is migration 113 applied? The invariant is unchecked until this resolves.",
      },
    ];
  }
  if (input.count > 0) {
    return [
      {
        severity: "error",
        check: "unpriceable-values",
        detail:
          `${input.count} ACTIVE unpriceable-type listing(s) carry an AVM value — the dwelling ` +
          "model has nothing valid to say about land/commercial, so these are wrong numbers on " +
          "live pages (and Deal Score inputs since #319). A full estimates recompute " +
          "(estimates-recompute.yml) clears them; if the count comes back, a writer is " +
          "bypassing the empty-result row-clear in refresh-property-estimates.ts.",
      },
    ];
  }
  return [];
}
