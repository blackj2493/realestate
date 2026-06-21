import { describe, it, expect } from "vitest";
import {
  evaluateRules,
  failCount,
  activeRuleCount,
  purchaseOnlyRuleCount,
  DEFAULT_RULES,
  type RuleSet,
} from "./dealBreakers";

const metrics = { listPrice: 899000, capRatePct: 3.9, beds: 3, trueDom: 38 };

describe("evaluateRules", () => {
  it("emits a result only for rules the user set", () => {
    const rules: RuleSet = { ...DEFAULT_RULES, minCapRatePct: 5 };
    const r = evaluateRules(metrics, rules);
    expect(r).toHaveLength(1);
    expect(r[0].status).toBe("fail"); // 3.9% < 5%
    expect(r[0].detail).toMatch(/below your floor/);
  });

  it("passes when the metric meets the rule", () => {
    const r = evaluateRules({ ...metrics, capRatePct: 6 }, { ...DEFAULT_RULES, minCapRatePct: 5 });
    expect(r[0].status).toBe("pass");
  });

  it("reports unknown when the metric is missing", () => {
    const rules: RuleSet = { minCapRatePct: 5, maxPrice: 1_000_000, minBeds: 3, minTrueDom: 30 };
    const r = evaluateRules({ listPrice: null, capRatePct: null, beds: null, trueDom: null }, rules);
    expect(r).toHaveLength(4);
    expect(r.every((x) => x.status === "unknown")).toBe(true);
  });

  it("evaluates price, beds and True DOM thresholds", () => {
    const rules: RuleSet = { minCapRatePct: null, maxPrice: 850_000, minBeds: 4, minTrueDom: 20 };
    const r = evaluateRules(metrics, rules);
    const byKey = Object.fromEntries(r.map((x) => [x.key, x.status]));
    expect(byKey.maxPrice).toBe("fail"); // 899k > 850k
    expect(byKey.minBeds).toBe("fail"); // 3 < 4
    expect(byKey.minTrueDom).toBe("pass"); // 38 >= 20
  });

  it("failCount + activeRuleCount", () => {
    const rules: RuleSet = { minCapRatePct: 5, maxPrice: 850_000, minBeds: null, minTrueDom: null };
    expect(activeRuleCount(rules)).toBe(2);
    expect(failCount(evaluateRules(metrics, rules))).toBe(2);
  });

  it("no rules set → no results", () => {
    expect(evaluateRules(metrics, DEFAULT_RULES)).toHaveLength(0);
  });
});

describe("evaluateRules — lease (purchase-only rules skipped)", () => {
  const leaseMetrics = { listPrice: 2700, capRatePct: null, beds: 2, trueDom: 0 };
  const allRules: RuleSet = { minCapRatePct: 5, maxPrice: 900_000, minBeds: 3, minTrueDom: 21 };

  it("does NOT screen cap rate or max price on a lease (avoids the always-true '$2,700 ≤ $900K' pass)", () => {
    const r = evaluateRules(leaseMetrics, allRules, { isLease: true });
    const keys = r.map((x) => x.key);
    expect(keys).not.toContain("minCapRatePct");
    expect(keys).not.toContain("maxPrice");
    expect(keys).toEqual(["minBeds", "minTrueDom"]); // only universal rules survive
  });

  it("still evaluates beds and True DOM on a lease", () => {
    const r = evaluateRules(leaseMetrics, allRules, { isLease: true });
    const byKey = Object.fromEntries(r.map((x) => [x.key, x.status]));
    expect(byKey.minBeds).toBe("fail"); // 2 < 3
    expect(byKey.minTrueDom).toBe("fail"); // 0 < 21
  });

  it("isLease:false (default) is unchanged — all four rules screen", () => {
    expect(evaluateRules(leaseMetrics, allRules)).toHaveLength(4);
    expect(evaluateRules(leaseMetrics, allRules, { isLease: false })).toHaveLength(4);
  });

  it("purchaseOnlyRuleCount counts only the cap-rate / max-price rules the user set", () => {
    expect(purchaseOnlyRuleCount(allRules)).toBe(2);
    expect(purchaseOnlyRuleCount({ ...DEFAULT_RULES, minBeds: 3 })).toBe(0);
    expect(purchaseOnlyRuleCount({ ...DEFAULT_RULES, maxPrice: 900_000 })).toBe(1);
  });
});
