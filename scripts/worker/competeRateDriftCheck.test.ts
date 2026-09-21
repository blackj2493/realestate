import { describe, it, expect } from "vitest";
import { assessCompeteDrift, type ResultRow, type DriftThresholds } from "./competeRateDriftCheck";
import { COMPETITIVE_PATTERNS, COMPETITIVE_COMP_MARGIN } from "@/lib/avm/salePrice";

const T: DriftThresholds = { maxDrift: 0.1, maxRatioDrift: 0.03, minN: 150 };

/** The published rates the canary is guarding, looked up rather than restated. */
const published = (name: string, market: "gta" | "other") =>
  COMPETITIVE_PATTERNS.find((p) => p.name === name)!.rates[market]!;

/**
 * n held-out sales at one ask, in one market, where `overFrac` of them closed over ask.
 * Comp value is set just past COMPETITIVE_COMP_MARGIN so every row lands below-comps.
 * Over-ask rows close at `ratioOver`, the rest at `ratioUnder` — so the bucket's MEDIAN
 * close/list is controllable independently of the over-ask RATE.
 */
function sales(opts: {
  n: number;
  list: number;
  city: string;
  overFrac: number;
  ratioOver?: number;
  ratioUnder?: number;
  confidence?: string;
  compMultiple?: number;
}): ResultRow[] {
  const { n, list, city, overFrac } = opts;
  const rOver = opts.ratioOver ?? 1.04;
  const rUnder = opts.ratioUnder ?? 0.98;
  const overCount = Math.round(n * overFrac);
  return Array.from({ length: n }, (_, i) => ({
    list_price: list,
    close_price: Math.round(list * (i < overCount ? rOver : rUnder)),
    estimated_value: Math.round(list * (opts.compMultiple ?? 1 + COMPETITIVE_COMP_MARGIN + 0.02)),
    city,
    confidence: opts.confidence ?? "HIGH",
  }));
}

/**
 * A bucket that matches its published numbers exactly — the healthy baseline.
 *
 * The two statistics are coupled: the median close/list sits above 1 exactly when more than
 * half the bucket closed over ask. So the published median tells us which half of the bucket
 * the median falls in, and the target ratio goes on THAT half. Putting it on the wrong half
 * (e.g. "under-ask" rows at 1.011) silently makes every row an over-ask row.
 */
function healthy(name: "threshold" | "lucky-88", market: "gta" | "other", list: number, city: string, n = 400) {
  const p = published(name, market);
  const medianIsOverAsk = p.medianCloseRatio > 1;
  return sales({
    n,
    list,
    city,
    overFrac: p.overAskRate,
    ratioOver: medianIsOverAsk ? p.medianCloseRatio : 1.05,
    ratioUnder: medianIsOverAsk ? 0.95 : p.medianCloseRatio,
  });
}

describe("assessCompeteDrift", () => {
  it("passes when every gated bucket still matches its published rates", () => {
    const rows = [
      ...healthy("threshold", "gta", 999_000, "Toronto C12"),
      ...healthy("threshold", "other", 999_000, "London"),
    ];
    const a = assessCompeteDrift(rows, T);
    expect(a.belowComps).toBe(rows.length);
    expect(a.failures).toEqual([]);
  });

  it("fails when a published over-ask rate no longer matches the data", () => {
    // Same ask shape, but these homes stopped going over ask.
    const rows = sales({ n: 400, list: 999_000, city: "Toronto C12", overFrac: 0.2 });
    const a = assessCompeteDrift(rows, T);
    expect(a.failures.some((f) => f.startsWith("threshold/gta") && /over-ask rate/.test(f))).toBe(true);
  });

  it("fails when the median close/list drifts, even if the over-ask rate holds", () => {
    // Uses the non-GTA bucket: its over-ask rate is below 50%, so the median sits in the
    // under-ask rows and can be moved without disturbing the rate.
    const p = published("threshold", "other");
    const rows = sales({
      n: 400,
      list: 999_000,
      city: "London",
      overFrac: p.overAskRate, // rate is fine…
      ratioOver: 1.05,
      ratioUnder: p.medianCloseRatio - 0.1, // …but the typical close fell away
    });
    const a = assessCompeteDrift(rows, T);
    expect(a.failures.some((f) => /median close\/list/.test(f))).toBe(true);
    expect(a.failures.some((f) => /over-ask rate/.test(f))).toBe(false);
  });

  it("reports but never fails a bucket thinner than minN — a canary that cries wolf gets muted", () => {
    const rows = sales({ n: 20, list: 688_000, city: "Toronto C12", overFrac: 0.0 });
    const a = assessCompeteDrift(rows, T);
    expect(a.failures).toEqual([]);
    expect(a.skipped.some((s) => s.startsWith("lucky-88/gta"))).toBe(true);
    expect(a.lines.some((l) => l.includes("reported only"))).toBe(true);
  });

  it("judges each market against its own published rate, not a pooled one", () => {
    // The GTA rate applied to a non-GTA bucket would read as drift; the correct rate does not.
    const gtaRate = published("threshold", "gta").overAskRate;
    const otherP = published("threshold", "other");
    const rows = sales({
      n: 400,
      list: 999_000,
      city: "London",
      overFrac: otherP.overAskRate,
      ratioOver: 1.05,
      ratioUnder: otherP.medianCloseRatio,
    });
    const a = assessCompeteDrift(rows, T);
    expect(a.failures).toEqual([]);
    // sanity: the two published rates really are far apart, so this test has teeth
    expect(Math.abs(gtaRate - otherP.overAskRate)).toBeGreaterThan(T.maxDrift);
  });

  it("excludes LOW-confidence comps, mirroring detectCompetitive", () => {
    const rows = sales({ n: 400, list: 999_000, city: "Toronto C12", overFrac: 0.0, confidence: "LOW" });
    const a = assessCompeteDrift(rows, T);
    expect(a.belowComps).toBe(0); // nothing survived the guard…
    expect(a.failures).toEqual([]); // …so nothing is judged
  });

  it("excludes homes the AVM did NOT price above the ask", () => {
    const rows = sales({ n: 400, list: 999_000, city: "Toronto C12", overFrac: 0.0, compMultiple: 1.01 });
    const a = assessCompeteDrift(rows, T);
    expect(a.usable).toBe(400); // counted as usable closings…
    expect(a.belowComps).toBe(0); // …but not below comps, so out of scope
  });

  it("reports the below-comps base rate per market, never pooled", () => {
    const rows = [
      ...sales({ n: 200, list: 1_250_000, city: "Toronto C12", overFrac: 0.6 }),
      ...sales({ n: 200, list: 1_250_000, city: "London", overFrac: 0.1 }),
    ];
    const a = assessCompeteDrift(rows, T);
    expect(a.baseOverAsk.gta).toBeCloseTo(0.6, 2);
    expect(a.baseOverAsk.other).toBeCloseTo(0.1, 2);
  });

  it("guards every published bucket in the table — a new pattern is covered automatically", () => {
    const expected = COMPETITIVE_PATTERNS.flatMap((p) =>
      (Object.keys(p.rates) as Array<"gta" | "other">)
        .filter((m) => p.rates[m])
        .map((m) => `${p.name}/${m}`),
    );
    // Feed one matching sale per published bucket; each must appear in the report.
    const rows = [
      ...sales({ n: 1, list: 999_000, city: "Toronto C12", overFrac: 1 }),
      ...sales({ n: 1, list: 999_000, city: "London", overFrac: 1 }),
      ...sales({ n: 1, list: 688_000, city: "Toronto C12", overFrac: 1 }),
    ];
    const a = assessCompeteDrift(rows, T);
    for (const label of expected) {
      expect(a.lines.some((l) => l.includes(label)) || a.skipped.some((s) => s.startsWith(label))).toBe(true);
    }
  });

  it("handles an empty backtest without throwing", () => {
    const a = assessCompeteDrift([], T);
    expect(a.belowComps).toBe(0);
    expect(a.failures).toEqual([]);
  });
});
