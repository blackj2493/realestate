import { describe, it, expect } from "vitest";
import {
  checkRpcTimeouts,
  parseTimeoutMs,
  EXPECTED_RPC_TIMEOUT_MS,
  EXTRA_WATCHED_RPCS,
  MIN_RPC_TIMEOUT_MS,
  type RpcTimeoutRow,
} from "@/lib/data/rpcTimeouts";

/**
 * Regression suite for the RPC statement_timeout invariant.
 *
 * The first case REPLAYS migration 133: region_rental_yield's 60s budget deleted by a
 * CREATE OR REPLACE that omitted the SET clause, which cost 13 nights of null Ottawa rental
 * yield while every output-side check reported only the symptom. The rest pin the properties
 * that keep the check trustworthy — it must not cry wolf on a healthy catalog, and it must
 * not fall silent when the thing it watches disappears.
 */

/** The live prod catalog after migration 141, as rpc_statement_timeouts returns it. */
const healthy = (): RpcTimeoutRow[] => [
  { functionName: "region_active_aggregates", identityArgs: "p_region text, p_subtypes text[]", statementTimeout: "90s" },
  { functionName: "region_dom_distribution", identityArgs: "p_region text, p_subtypes text[]", statementTimeout: "90s" },
  { functionName: "region_price_cuts", identityArgs: "p_region text, p_subtypes text[]", statementTimeout: "90s" },
  { functionName: "region_avm_reliability", identityArgs: "p_region text, p_subtypes text[]", statementTimeout: "60s" },
  { functionName: "region_listing_outcomes", identityArgs: "p_region text, p_subtypes text[], p_months integer", statementTimeout: "60s" },
  { functionName: "region_price_trend", identityArgs: "p_region text, p_subtypes text[]", statementTimeout: "60s" },
  { functionName: "region_rental_yield", identityArgs: "p_region text, p_subtypes text[]", statementTimeout: "60s" },
  { functionName: "region_seasonality", identityArgs: "p_region text, p_subtypes text[]", statementTimeout: "60s" },
  { functionName: "region_sold_dynamics", identityArgs: "p_region text, p_subtypes text[], p_months integer", statementTimeout: "60s" },
  { functionName: "region_price_events_summary", identityArgs: "p_region text, p_months integer", statementTimeout: "30s" },
  { functionName: "count_unpriceable_valued_estimates", identityArgs: "p_exact text[], p_patterns text[], p_terminal text[]", statementTimeout: "45s" },
  { functionName: "city_trend_coverage", identityArgs: "p_min_actives integer, p_terminal text[], p_exact text[], p_patterns text[]", statementTimeout: "45s" },
];

describe("checkRpcTimeouts", () => {
  it("replays migration 133: a CREATE OR REPLACE that dropped region_rental_yield's SET clause", () => {
    const rows = healthy().map((r) =>
      r.functionName === "region_rental_yield" ? { ...r, statementTimeout: null } : r
    );

    const problems = checkRpcTimeouts(rows);
    expect(problems).toHaveLength(1);
    expect(problems[0].severity).toBe("error");
    expect(problems[0].check).toBe("rpc-timeouts");
    expect(problems[0].detail).toContain("region_rental_yield");
    expect(problems[0].detail).toContain("declares no statement_timeout");
    // The detail must name the budget it actually fell back to, or the reader has to go
    // looking up what authenticator carries.
    expect(problems[0].detail).toContain("8s");
  });

  it("stays silent on the live prod catalog — it must not cry wolf", () => {
    expect(checkRpcTimeouts(healthy())).toEqual([]);
  });

  it("accepts a RAISED budget but flags a LOWERED one", () => {
    const raised = healthy().map((r) =>
      r.functionName === "region_rental_yield" ? { ...r, statementTimeout: "2min" } : r
    );
    expect(checkRpcTimeouts(raised)).toEqual([]);

    const lowered = healthy().map((r) =>
      r.functionName === "region_rental_yield" ? { ...r, statementTimeout: "10s" } : r
    );
    const problems = checkRpcTimeouts(lowered);
    expect(problems).toHaveLength(1);
    expect(problems[0].detail).toContain("below the expected 60s");
  });

  it("covers a NEW region_* RPC with no recorded expectation, via the prefix rule", () => {
    const withNew = [
      ...healthy(),
      { functionName: "region_new_thing", identityArgs: "p_region text", statementTimeout: null },
    ];
    const problems = checkRpcTimeouts(withNew);
    expect(problems).toHaveLength(1);
    expect(problems[0].detail).toContain("region_new_thing");
    expect(problems[0].detail).toContain(`${MIN_RPC_TIMEOUT_MS / 1000}s is expected`);

    // …and passes once it declares one clear of the role floor.
    const fixed = withNew.map((r) =>
      r.functionName === "region_new_thing" ? { ...r, statementTimeout: "30s" } : r
    );
    expect(checkRpcTimeouts(fixed)).toEqual([]);
  });

  it("flags EVERY overload, not just the one that carries a budget", () => {
    const rows = [
      ...healthy(),
      { functionName: "region_rental_yield", identityArgs: "p_region text", statementTimeout: null },
    ];
    const problems = checkRpcTimeouts(rows);
    expect(problems).toHaveLength(1);
    expect(problems[0].detail).toContain("region_rental_yield(p_region text)");
  });

  it("errors when an expected function vanishes — renamed, dropped, or re-signed", () => {
    const rows = healthy().filter((r) => r.functionName !== "count_unpriceable_valued_estimates");
    const problems = checkRpcTimeouts(rows);
    expect(problems).toHaveLength(1);
    expect(problems[0].severity).toBe("error");
    expect(problems[0].detail).toContain("count_unpriceable_valued_estimates");
    expect(problems[0].detail).toContain("was not found in public");
  });

  it("warns rather than passing when the RPC itself returns nothing (142 unapplied)", () => {
    const problems = checkRpcTimeouts([]);
    expect(problems).toHaveLength(1);
    expect(problems[0].severity).toBe("warn");
    expect(problems[0].detail).toContain("migration 142");
  });

  it("treats an unreadable budget as unverified, never as a pass", () => {
    const rows = healthy().map((r) =>
      r.functionName === "region_price_cuts" ? { ...r, statementTimeout: "soon" } : r
    );
    const problems = checkRpcTimeouts(rows);
    expect(problems).toHaveLength(1);
    expect(problems[0].severity).toBe("error");
    expect(problems[0].detail).toContain("unreadable statement_timeout");
  });

  it("ignores functions outside the watched set", () => {
    const rows = [...healthy(), { functionName: "st_area", identityArgs: "geometry", statementTimeout: null }];
    expect(checkRpcTimeouts(rows)).toEqual([]);
  });
});

describe("parseTimeoutMs", () => {
  it("reads every form statement_timeout can store", () => {
    expect(parseTimeoutMs("60s")).toBe(60_000);
    expect(parseTimeoutMs("90s")).toBe(90_000);
    expect(parseTimeoutMs("45000")).toBe(45_000); // bare number = ms
    expect(parseTimeoutMs("1min")).toBe(60_000);
    expect(parseTimeoutMs("2min")).toBe(120_000);
    expect(parseTimeoutMs("500ms")).toBe(500);
    expect(parseTimeoutMs("1h")).toBe(3_600_000);
    expect(parseTimeoutMs(" 60S ")).toBe(60_000); // Postgres normalizes, but be forgiving
  });

  it("returns null for absent or unparseable values rather than guessing", () => {
    expect(parseTimeoutMs(null)).toBeNull();
    expect(parseTimeoutMs(undefined)).toBeNull();
    expect(parseTimeoutMs("")).toBeNull();
    expect(parseTimeoutMs("soon")).toBeNull();
    expect(parseTimeoutMs("60 seconds")).toBeNull();
  });
});

describe("EXTRA_WATCHED_RPCS", () => {
  it("is exactly the non-region_* expectations — the list passed to p_names", () => {
    // region_* names are matched by prefix inside the SQL, so passing them would be
    // redundant; anything else MUST be passed or the check silently never sees it.
    expect(EXTRA_WATCHED_RPCS.every((n) => !n.startsWith("region_"))).toBe(true);
    expect(new Set(EXTRA_WATCHED_RPCS)).toEqual(
      new Set(Object.keys(EXPECTED_RPC_TIMEOUT_MS).filter((n) => !n.startsWith("region_")))
    );
  });
});
