/**
 * Deal-breaker rules — pure evaluation of a listing against the user's own thresholds.
 *
 * Decision scaffolding for the listing page: the user sets a few personal rules once
 * (min cap rate, max price, min beds, min True DOM) and every listing is auto-screened
 * against them. Pure & deterministic (no IO, no React) so it is unit-testable and can
 * be reused server-side later. The UI (YourTakeCard) owns persistence.
 *
 * COMPLIANCE (CLAUDE.md §4): arithmetic comparison only — no LLM, no feed transformation.
 */

export interface RuleSet {
  /** Fail when cap rate is below this %. */
  minCapRatePct: number | null;
  /** Fail when list price is above this ($). */
  maxPrice: number | null;
  /** Fail when bedroom count is below this. */
  minBeds: number | null;
  /** Fail when True DOM is below this (distress hunters want stale listings). */
  minTrueDom: number | null;
}

export const DEFAULT_RULES: RuleSet = {
  minCapRatePct: null,
  maxPrice: null,
  minBeds: null,
  minTrueDom: null,
};

export interface ListingMetrics {
  listPrice: number | null;
  capRatePct: number | null;
  beds: number | null;
  trueDom: number | null;
}

/**
 * Rules that only make sense for a PURCHASE. On a For-Lease listing a rental has no
 * purchase cap rate, and ListPrice is the monthly rent (so "price ≤ $900K" is an
 * always-true non-test) — screening on these would manufacture a misleading pass.
 * Beds and True DOM are universal and still apply to leases.
 */
export const PURCHASE_ONLY_RULES: ReadonlySet<keyof RuleSet> = new Set(["minCapRatePct", "maxPrice"]);

export interface EvaluateOptions {
  /** True for lease listings — purchase-only rules are skipped (not evaluated). */
  isLease?: boolean;
}

/** How many purchase-only rules the user has set (drives the "n/a on leases" note). */
export function purchaseOnlyRuleCount(rules: RuleSet): number {
  return [...PURCHASE_ONLY_RULES].filter((k) => rules[k] != null).length;
}

export type RuleStatus = "pass" | "fail" | "unknown";

export interface RuleResult {
  key: keyof RuleSet;
  label: string;
  status: RuleStatus;
  detail: string;
}

function money(v: number): string {
  const a = Math.abs(Math.round(v));
  if (a >= 1_000_000) return `$${(a / 1_000_000).toFixed(a % 1_000_000 === 0 ? 0 : 1)}M`;
  if (a >= 1_000) return `$${Math.round(a / 1_000)}K`;
  return `$${a}`;
}

/** Evaluate a listing against the rules the user has actually set (non-null). */
export function evaluateRules(m: ListingMetrics, rules: RuleSet, opts: EvaluateOptions = {}): RuleResult[] {
  const out: RuleResult[] = [];
  const skipPurchase = !!opts.isLease;

  if (rules.minCapRatePct != null && !skipPurchase) {
    const label = `Cap rate ≥ ${rules.minCapRatePct}%`;
    if (m.capRatePct == null) out.push({ key: "minCapRatePct", label, status: "unknown", detail: "no cap-rate estimate" });
    else {
      const ok = m.capRatePct >= rules.minCapRatePct;
      out.push({ key: "minCapRatePct", label, status: ok ? "pass" : "fail", detail: `${m.capRatePct.toFixed(1)}%${ok ? "" : " — below your floor"}` });
    }
  }

  if (rules.maxPrice != null && !skipPurchase) {
    const label = `Price ≤ ${money(rules.maxPrice)}`;
    if (m.listPrice == null || m.listPrice <= 0) out.push({ key: "maxPrice", label, status: "unknown", detail: "no price" });
    else {
      const ok = m.listPrice <= rules.maxPrice;
      out.push({ key: "maxPrice", label, status: ok ? "pass" : "fail", detail: `${money(m.listPrice)}${ok ? "" : " — over budget"}` });
    }
  }

  if (rules.minBeds != null) {
    const label = `Beds ≥ ${rules.minBeds}`;
    if (m.beds == null) out.push({ key: "minBeds", label, status: "unknown", detail: "not stated" });
    else {
      const ok = m.beds >= rules.minBeds;
      out.push({ key: "minBeds", label, status: ok ? "pass" : "fail", detail: `${m.beds} bed${ok ? "" : " — too few"}` });
    }
  }

  if (rules.minTrueDom != null) {
    const label = `True DOM ≥ ${rules.minTrueDom}d`;
    if (m.trueDom == null) out.push({ key: "minTrueDom", label, status: "unknown", detail: "n/a" });
    else {
      const ok = m.trueDom >= rules.minTrueDom;
      out.push({ key: "minTrueDom", label, status: ok ? "pass" : "fail", detail: `${m.trueDom}d${ok ? "" : " — too fresh"}` });
    }
  }

  return out;
}

export function failCount(results: RuleResult[]): number {
  return results.filter((r) => r.status === "fail").length;
}

export function activeRuleCount(rules: RuleSet): number {
  return (Object.values(rules) as (number | null)[]).filter((v) => v != null).length;
}
