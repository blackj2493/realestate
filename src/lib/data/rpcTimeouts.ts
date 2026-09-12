/**
 * RPC statement_timeout invariant — the cause-side check for a class of bug that has cost
 * two incidents and was invisible to every output-side check we had.
 *
 * `CREATE OR REPLACE FUNCTION` replaces the whole declaration, `proconfig` included. Omit the
 * `SET statement_timeout` line from the new body and the budget is DELETED — silently, and
 * with nothing in the diff that reads as a removal. The function then inherits the caller's
 * budget, and PostgREST logs in as `authenticator`, which carries statement_timeout = 8s.
 *
 * That is what happened to region_rental_yield: migration 123 gave it 60s, migration 133
 * re-declared the body without repeating the line, and migration 135 copied the live
 * (already SET-less) definition and carried the omission forward. Ottawa's rental yield needs
 * ~4.3s on its own and 24.1s beside its ten sibling slices in the nightly fan-out, so it
 * failed 57014 every night for 13 days and the canary reported the symptom — "Ottawa: no
 * rental yield rows" — while the cause sat one catalog column away.
 *
 * So this check reads the column. Two rules, chosen so that neither drifts into a lie:
 *
 *   1. EVERY `region_*` RPC must declare a budget above the role floor. Prefix-based on
 *      purpose: a region RPC added next month is covered the day it lands, with no list for
 *      anyone to remember. All 12 such functions satisfy this today, so the rule costs
 *      nothing to hold and fires the moment one stops holding it.
 *   2. Each name in EXPECTED_RPC_TIMEOUT_MS must declare AT LEAST its recorded value. A floor,
 *      not an equality — raising a budget is routine and must not page, while lowering one is
 *      exactly the silent regression worth catching, and forces whoever lowers it to say so
 *      here.
 *
 * The floors below are the values measured live on prod 2026-09-12, after migration 141
 * restored region_rental_yield's.
 */

/**
 * `authenticator`'s own budget — what a function with NO declared timeout actually gets
 * through PostgREST (anon is 3s, authenticated 8s, service_role null). A watched RPC sitting
 * at or below this is either missing its SET or has been lowered into uselessness.
 */
export const ROLE_TIMEOUT_MS = 8_000;

/** Floor for a watched RPC with no recorded expectation: clear of the role budget with margin. */
export const MIN_RPC_TIMEOUT_MS = 10_000;

/**
 * Minimum statement_timeout each watched RPC must declare, in ms. Names NOT matching
 * `region_*` are also the extra list passed to rpc_statement_timeouts(p_names) — keep them in
 * this one place, per the migration-113 rule that the SQL holds no second copy of a list.
 */
export const EXPECTED_RPC_TIMEOUT_MS: Record<string, number> = {
  // The /analytics + region_metrics slice RPCs.
  region_active_aggregates: 90_000,
  region_dom_distribution: 90_000,
  region_price_cuts: 90_000,
  region_avm_reliability: 60_000,
  region_listing_outcomes: 60_000,
  region_price_trend: 60_000,
  // 60s restored by migration 141 after migration 133 deleted it. The reason this file exists.
  region_rental_yield: 60_000,
  region_seasonality: 60_000,
  region_sold_dynamics: 60_000,
  region_price_events_summary: 30_000,
  // Data-health canary reads. 45s each, set because both scans cost ~23s cold against a
  // 3.9 GB listings table (migrations 126 and 131).
  count_unpriceable_valued_estimates: 45_000,
  city_trend_coverage: 45_000,
};

/** The non-`region_*` names the RPC must be asked for explicitly. */
export const EXTRA_WATCHED_RPCS: string[] = Object.keys(EXPECTED_RPC_TIMEOUT_MS).filter(
  (n) => !n.startsWith("region_")
);

export interface RpcTimeoutRow {
  functionName: string;
  identityArgs: string;
  /** Raw proconfig value ('60s', '90s', '45000', …), or null when the function declares none. */
  statementTimeout: string | null;
}

export interface Problem {
  severity: "error" | "warn";
  check: string;
  detail: string;
}

/**
 * Parse a Postgres interval-ish timeout into ms. `statement_timeout` accepts a bare number
 * (milliseconds) or a number with a unit, and stores back whatever normalized form it chose —
 * so all of '60s', '60000', '1min' and '2min' are values this can legitimately see.
 *
 * Returns null for anything unparseable, which the caller treats as a problem rather than as
 * a pass: an unreadable budget is not a verified one.
 */
export function parseTimeoutMs(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const s = raw.trim().toLowerCase();
  if (!s) return null;

  const m = /^(\d+(?:\.\d+)?)\s*(us|ms|s|min|h|d)?$/.exec(s);
  if (!m) return null;

  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;

  switch (m[2]) {
    case undefined:
    case "ms":
      return n;
    case "us":
      return n / 1000;
    case "s":
      return n * 1_000;
    case "min":
      return n * 60_000;
    case "h":
      return n * 3_600_000;
    case "d":
      return n * 86_400_000;
    default:
      return null;
  }
}

const fmt = (ms: number) => (ms % 1000 === 0 ? `${ms / 1000}s` : `${ms}ms`);

/**
 * Check the watched RPCs' declared budgets. Rows come from rpc_statement_timeouts (142).
 *
 * An overloaded name must satisfy the rule on EVERY overload — a second signature with no
 * budget is reachable from PostgREST just as easily as the one that has it.
 */
export function checkRpcTimeouts(rows: RpcTimeoutRow[]): Problem[] {
  const out: Problem[] = [];

  if (rows.length === 0) {
    return [
      {
        severity: "warn",
        check: "rpc-timeouts",
        detail:
          "rpc_statement_timeouts returned no rows — is migration 142 applied? The invariant is unchecked until this resolves.",
      },
    ];
  }

  const seen = new Set<string>();

  for (const r of rows) {
    const watched = r.functionName.startsWith("region_") || r.functionName in EXPECTED_RPC_TIMEOUT_MS;
    if (!watched) continue;
    seen.add(r.functionName);

    const sig = `${r.functionName}(${r.identityArgs})`;
    const floor = EXPECTED_RPC_TIMEOUT_MS[r.functionName] ?? MIN_RPC_TIMEOUT_MS;

    if (r.statementTimeout == null) {
      out.push({
        severity: "error",
        check: "rpc-timeouts",
        detail:
          `${sig} declares no statement_timeout — it inherits authenticator's ${fmt(ROLE_TIMEOUT_MS)} ` +
          `through PostgREST, and ${fmt(floor)} is expected. A CREATE OR REPLACE that omitted the SET ` +
          `clause deletes it silently; restore it with ALTER FUNCTION ... SET statement_timeout.`,
      });
      continue;
    }

    const ms = parseTimeoutMs(r.statementTimeout);
    if (ms == null) {
      out.push({
        severity: "error",
        check: "rpc-timeouts",
        detail: `${sig} has an unreadable statement_timeout ("${r.statementTimeout}") — the budget cannot be verified.`,
      });
      continue;
    }

    if (ms < floor) {
      out.push({
        severity: "error",
        check: "rpc-timeouts",
        detail:
          `${sig} declares statement_timeout=${r.statementTimeout} (${fmt(ms)}), below the expected ` +
          `${fmt(floor)}. Lower it deliberately by updating EXPECTED_RPC_TIMEOUT_MS, or restore the budget.`,
      });
    }
  }

  // A name we expect but never saw: renamed, dropped, or re-signed without updating this
  // check. Silence there would be the same failure mode all over again.
  for (const name of Object.keys(EXPECTED_RPC_TIMEOUT_MS)) {
    if (!seen.has(name)) {
      out.push({
        severity: "error",
        check: "rpc-timeouts",
        detail:
          `${name} is expected to declare statement_timeout=${fmt(EXPECTED_RPC_TIMEOUT_MS[name])} but was not ` +
          `found in public — renamed, dropped, or re-signed? Update EXPECTED_RPC_TIMEOUT_MS if that was intended.`,
      });
    }
  }

  return out;
}
