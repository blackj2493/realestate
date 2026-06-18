import { describe, it, expect } from "vitest";
import { evaluateRules, failCount, activeRuleCount, DEFAULT_RULES, type RuleSet } from "./dealBreakers";

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
