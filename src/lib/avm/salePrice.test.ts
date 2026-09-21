import { describe, it, expect } from "vitest";
import {
  resolveSalePrice,
  detectCompetitive,
  RATIO_HIGH_CONFIDENCE_N,
  SALE_BAND_HALF_WIDTH,
  isThresholdPrice,
  matchCompetitivePattern,
  competitiveMarketOf,
  competitiveOutcomeFor,
  COMPETITIVE_PATTERNS,
  COMPETITIVE_GAP_RATES,
} from "./salePrice";
import { computeExpectedSale, type CloseListRatio } from "./expectedSale";
import type { AVMResult } from "./types";

const ratio = (over: Partial<CloseListRatio> = {}): CloseListRatio => ({
  ratio: 0.965,
  sampleSize: 60,
  windowMonths: 6,
  scope: "cohort",
  ...over,
});

// Minimal AVMResult fixture — only the fields the resolver reads matter.
const avm = (over: Partial<AVMResult> = {}): AVMResult =>
  ({
    estimatedValue: 1_050_000,
    anchorPrice: 1_000_000,
    totalAdjustmentPct: 0,
    engineMode: "COEFFICIENT_ADJUSTED",
    r2Score: 0.8,
    breakdown: {},
    confidence: "MEDIUM",
    comps: 20,
    nEff: 15,
    basis: "local",
    lowBand: 945_000,
    highBand: 1_155_000,
    predictiveSD: 0.1,
    ...over,
  }) as AVMResult;

describe("resolveSalePrice", () => {
  it("prefers the list-anchored Expected Sale for an active listing with a trustworthy ratio", () => {
    const list = 1_199_000;
    const es = computeExpectedSale(list, ratio({ ratio: 0.965, sampleSize: 60, scope: "cohort" }))!;
    const r = resolveSalePrice({ listPrice: list, isActive: true, expectedSale: es, estimate: avm(), city: "Toronto C12" })!;
    expect(r.source).toBe("expected-sale");
    expect(r.value).toBe(es.expectedPrice); // list × ratio, NOT the AVM
    expect(r.confidence).toBe("HIGH"); // cohort + n >= RATIO_HIGH_CONFIDENCE_N
    expect(r.deltaVsAskPct).toBeCloseTo((es.expectedPrice - list) / list, 6);
    expect(r.market).toEqual({ ratio: 0.965, sampleSize: 60, scope: "cohort", windowMonths: 6 });
    // AVM survives only as secondary "comparable value" context, never the headline.
    expect(r.comparable).toEqual({ low: 945_000, mid: 1_050_000, high: 1_155_000 });
  });

  it("maps confidence from cohort scope + sample size", () => {
    const list = 1_000_000;
    const mk = (over: Partial<CloseListRatio>) =>
      resolveSalePrice({
        listPrice: list,
        isActive: true,
        expectedSale: computeExpectedSale(list, ratio(over))!,
        estimate: null,
        city: "Toronto C12",
      })!.confidence;
    expect(mk({ scope: "cohort", sampleSize: RATIO_HIGH_CONFIDENCE_N })).toBe("HIGH");
    expect(mk({ scope: "cohort", sampleSize: RATIO_HIGH_CONFIDENCE_N - 1 })).toBe("MEDIUM");
    expect(mk({ scope: "city", sampleSize: RATIO_HIGH_CONFIDENCE_N })).toBe("MEDIUM");
    expect(mk({ scope: "city", sampleSize: 12 })).toBe("LOW");
  });

  it("scales the published band by confidence — wider when the cohort is thin", () => {
    const list = 1_000_000;
    const halfWidth = (over: Partial<CloseListRatio>) => {
      const r = resolveSalePrice({
        listPrice: list,
        isActive: true,
        expectedSale: computeExpectedSale(list, ratio(over))!,
        estimate: null,
        city: "Toronto C12",
      })!;
      return (r.value - r.lowBand) / r.value; // realized half-width
    };
    expect(halfWidth({ scope: "cohort", sampleSize: 60 })).toBeCloseTo(SALE_BAND_HALF_WIDTH.HIGH, 3);
    expect(halfWidth({ scope: "cohort", sampleSize: 20 })).toBeCloseTo(SALE_BAND_HALF_WIDTH.MEDIUM, 3);
    expect(halfWidth({ scope: "city", sampleSize: 20 })).toBeCloseTo(SALE_BAND_HALF_WIDTH.LOW, 3);
    // monotone: a less-supported ratio never gets a tighter range
    expect(SALE_BAND_HALF_WIDTH.HIGH).toBeLessThanOrEqual(SALE_BAND_HALF_WIDTH.MEDIUM);
    expect(SALE_BAND_HALF_WIDTH.MEDIUM).toBeLessThanOrEqual(SALE_BAND_HALF_WIDTH.LOW);
  });

  it("falls back to the AVM when an active listing has no trustworthy ratio", () => {
    const list = 1_000_000;
    const r = resolveSalePrice({ listPrice: list, isActive: true, expectedSale: null, estimate: avm(), city: "Toronto C12" })!;
    expect(r.source).toBe("avm");
    expect(r.value).toBe(1_050_000);
    expect(r.confidence).toBe("MEDIUM"); // passes through the AVM confidence
    expect(r.market).toBeNull();
    expect(r.comparable).toBeNull();
    expect(r.deltaVsAskPct).toBeCloseTo(0.05, 6); // (1.05M − 1M)/1M
    expect(r.provenance).toMatch(/asking price/i); // explains why it isn't list-anchored
  });

  it("uses the AVM for sold/off-market (no live ask), with no delta when listPrice is absent", () => {
    const r = resolveSalePrice({ listPrice: null, isActive: false, expectedSale: null, estimate: avm(), city: "Toronto C12" })!;
    expect(r.source).toBe("avm");
    expect(r.deltaVsAskPct).toBeNull();
  });

  it("synthesizes a ±10% band when the AVM bands are missing", () => {
    const r = resolveSalePrice({
      listPrice: 1_000_000,
      isActive: false,
      expectedSale: null,
      estimate: avm({ lowBand: 0, highBand: 0 }),
      city: "Toronto C12",
    })!;
    expect(r.lowBand).toBe(Math.round(1_050_000 * 0.9));
    expect(r.highBand).toBe(Math.round(1_050_000 * 1.1));
  });

  it("does NOT list-anchor when the listing is not active even if a ratio exists", () => {
    const es = computeExpectedSale(1_000_000, ratio())!;
    const r = resolveSalePrice({ listPrice: 1_000_000, isActive: false, expectedSale: es, estimate: avm(), city: "Toronto C12" })!;
    expect(r.source).toBe("avm");
  });

  it("returns null only when neither method can produce a number", () => {
    expect(resolveSalePrice({ listPrice: 1_000_000, isActive: true, expectedSale: null, estimate: null, city: "Toronto C12" })).toBeNull();
    expect(
      resolveSalePrice({
        listPrice: null,
        isActive: false,
        expectedSale: null,
          estimate: avm({ estimatedValue: 0, anchorPrice: 0 }),
        city: "Toronto C12",
      })
    ).toBeNull();
  });
});

describe("COMPETITIVE_GAP_RATES · measured outcomes by comp-gap depth", () => {
  it("restricts each pattern to the markets it was measured in", () => {
    const byName = Object.fromEntries(COMPETITIVE_PATTERNS.map((p) => [p.name, p]));
    expect(byName["threshold"].markets).toEqual(["gta", "other"]);
    // lucky-88 matched only 17 non-GTA closings — too thin to publish, so it stays GTA-only.
    expect(byName["lucky-88"].markets).toEqual(["gta"]);
    for (const p of COMPETITIVE_PATTERNS) expect(p.markets.length).toBeGreaterThan(0);
  });

  it("keeps bands ascending and sane in both markets", () => {
    for (const market of ["gta", "other"] as const) {
      const bands = COMPETITIVE_GAP_RATES[market];
      expect(bands.length).toBeGreaterThan(0);
      for (let i = 0; i < bands.length; i++) {
        const b = bands[i];
        if (i > 0) expect(b.minGap).toBeGreaterThan(bands[i - 1].minGap);
        expect(b.overAskRate).toBeGreaterThan(0);
        expect(b.overAskRate).toBeLessThan(1);
        // p75 can never sit below the median it is drawn from.
        expect(b.p75CloseRatio).toBeGreaterThanOrEqual(b.medianCloseRatio);
        // The whole reason this table exists: these homes close BELOW the comp estimate.
        expect(b.closeVsCompMid).toBeLessThan(1);
        expect(b.reachedCompMid).toBeLessThan(0.5);
      }
    }
  });

  it("shows a deeper comp gap meaning LESS of the comp estimate is realised", () => {
    // The finding that drove this change: a bigger gap is mostly model error, not headroom.
    for (const market of ["gta", "other"] as const) {
      const bands = COMPETITIVE_GAP_RATES[market];
      expect(bands[bands.length - 1].closeVsCompMid).toBeLessThan(bands[0].closeVsCompMid);
    }
  });

  it("picks the deepest band the gap clears", () => {
    expect(competitiveOutcomeFor("gta", 0.27)!.minGap).toBe(0.2);
    expect(competitiveOutcomeFor("gta", 0.06)!.minGap).toBe(0.05);
    expect(competitiveOutcomeFor("gta", 1.5)!.minGap).toBe(0.3);
    expect(competitiveOutcomeFor("gta", 0.04)).toBeNull(); // below the shallowest band
  });

  it("maps TRREB district strings and regional municipalities to the gta market", () => {
    expect(competitiveMarketOf("Toronto C12")).toBe("gta");
    expect(competitiveMarketOf("Markham")).toBe("gta");
    expect(competitiveMarketOf("Oakville")).toBe("gta");
  });

  it("treats everything else — and a missing city — as the conservative other market", () => {
    expect(competitiveMarketOf("Ottawa")).toBe("other");
    expect(competitiveMarketOf(null)).toBe("other");
    expect(competitiveMarketOf("")).toBe("other");
  });

  it("recognises the lucky-88 ask in the GTA and withholds it elsewhere", () => {
    expect(matchCompetitivePattern(688_000, "gta")).toBe("lucky-88");
    expect(matchCompetitivePattern(1_288_800, "gta")).toBe("lucky-88");
    expect(matchCompetitivePattern(688_000, "other")).toBeNull(); // n=17, too thin to publish
    expect(matchCompetitivePattern(999_000, "other")).toBe("threshold");
    expect(matchCompetitivePattern(1_250_000, "gta")).toBeNull();
  });

  it("publishes a weaker outcome outside the GTA at the same depth", () => {
    const g = competitiveOutcomeFor("gta", 0.25)!;
    const o = competitiveOutcomeFor("other", 0.25)!;
    expect(o.overAskRate).toBeLessThan(g.overAskRate);
    // Outside the GTA the median never clears the ask, however deep the gap.
    expect(o.medianCloseRatio).toBeLessThan(1);
    expect(g.medianCloseRatio).toBeGreaterThan(1);
  });
});

describe("isThresholdPrice", () => {
  it("flags the top $5k of a $100k band ($x95,000–$x99,999)", () => {
    expect(isThresholdPrice(999_000)).toBe(true); // 99,000
    expect(isThresholdPrice(1_299_000)).toBe(true);
    expect(isThresholdPrice(995_000)).toBe(true); // 95,000 (edge, inclusive)
    expect(isThresholdPrice(899_900)).toBe(true);
  });
  it("rejects round / mid-band prices", () => {
    expect(isThresholdPrice(1_000_000)).toBe(false); // 0
    expect(isThresholdPrice(1_250_000)).toBe(false); // 50,000
    expect(isThresholdPrice(1_094_999)).toBe(false); // 94,999 (just below the cutoff)
    expect(isThresholdPrice(0)).toBe(false);
  });
});

describe("resolveSalePrice · competitive (priced-to-compete) detection", () => {
  // A deliberately under-listed home: threshold ask well below the comp band.
  const es = (list: number, r = 0.98) => computeExpectedSale(list, ratio({ ratio: r }))!;
  const underComps = avm({ estimatedValue: 1_258_000, lowBand: 1_180_000, highBand: 1_340_000 });

  it("fires when the ask is threshold-shaped AND sits below comps", () => {
    const list = 999_000;
    const r = resolveSalePrice({ listPrice: list, isActive: true, expectedSale: es(list), estimate: underComps, city: "Toronto C12" })!;
    expect(r.competitive).not.toBeNull();
    expect(r.competitive!.pattern).toBe("threshold");
    // Both endpoints are MEASURED closes for this market at this depth, not comp-band edges.
    const gap = 1_258_000 / list - 1; // ~25.9%
    const band = competitiveOutcomeFor("gta", gap)!;
    expect(r.competitive!.rangeLow).toBe(Math.round(list * band.medianCloseRatio));
    expect(r.competitive!.rangeHigh).toBe(Math.round(list * band.p75CloseRatio));
    expect(r.competitive!.likelyClose).toBe(Math.round(list * band.medianCloseRatio));
    expect(r.competitive!.overAskRate).toBe(band.overAskRate);
    expect(r.competitive!.medianCloseRatio).toBe(band.medianCloseRatio);
    expect(r.competitive!.belowCompsPct).toBeCloseTo((1_258_000 - list) / 1_258_000, 6);
    // The ceiling must NOT be the AVM low band any more — that was the bug.
    expect(r.competitive!.rangeHigh).not.toBe(1_180_000);
    // The headline number is UNCHANGED — the treatment is presentation-only.
    expect(r.source).toBe("expected-sale");
    expect(r.value).toBe(es(list).expectedPrice);
  });

  it("does NOT fire when the price is not threshold-shaped", () => {
    const list = 1_250_000; // mid-band
    const r = resolveSalePrice({ listPrice: list, isActive: true, expectedSale: es(list), estimate: underComps, city: "Toronto C12" })!;
    expect(r.competitive).toBeNull();
  });

  it("does NOT fire when comps don't clear the ask by the margin", () => {
    const list = 999_000;
    const barelyOver = avm({ estimatedValue: 1_020_000, lowBand: 960_000, highBand: 1_080_000 }); // +2.1% only
    const r = resolveSalePrice({ listPrice: list, isActive: true, expectedSale: es(list), estimate: barelyOver, city: "Toronto C12" })!;
    expect(r.competitive).toBeNull();
  });

  it("does NOT fire on a LOW-confidence (noisy) comp band", () => {
    const list = 999_000;
    const r = resolveSalePrice({
      listPrice: list,
      isActive: true,
      expectedSale: es(list),
      estimate: avm({ estimatedValue: 1_258_000, lowBand: 1_180_000, highBand: 1_340_000, confidence: "LOW" }),
      city: "Toronto C12",
    })!;
    expect(r.competitive).toBeNull();
  });

  it("ignores the AVM band entirely when building the range — only the gap depth matters", () => {
    const list = 999_000;
    // Two listings, same ask and same comp MID, but wildly different band widths. The old
    // code read the ceiling off the band, so these produced different ranges. They must not.
    const tight = detectCompetitive(list, avm({ estimatedValue: 1_258_000, lowBand: 1_240_000, highBand: 1_276_000 }), "Toronto C12")!;
    const wide = detectCompetitive(list, avm({ estimatedValue: 1_258_000, lowBand: 900_000, highBand: 1_620_000 }), "Toronto C12")!;
    expect(tight.rangeHigh).toBe(wide.rangeHigh);
    expect(tight.rangeLow).toBe(wide.rangeLow);
  });

  it("scales the published outcome with the DEPTH of the comp gap", () => {
    const list = 999_000; // must be a qualifying ask shape, else nothing fires at all
    const shallow = detectCompetitive(list, avm({ estimatedValue: 1_080_000, lowBand: 1_000_000, highBand: 1_160_000 }), "Toronto C12")!;
    const deep = detectCompetitive(list, avm({ estimatedValue: 1_400_000, lowBand: 1_280_000, highBand: 1_520_000 }), "Toronto C12")!;
    expect(deep.overAskRate).toBeGreaterThan(shallow.overAskRate);
    expect(deep.rangeHigh).toBeGreaterThan(shallow.rangeHigh);
    // …and the deeper gap realises LESS of the comp estimate, not more.
    expect(deep.closeVsCompMid).toBeLessThan(shallow.closeVsCompMid);
  });

  it("never implies the home will reach the comparable estimate", () => {
    // The misread this change exists to prevent. A 27%-under-comps GTA listing closes at a
    // median ~82% of the comp mid, and the published ceiling stays well under it.
    const list = 688_000;
    const comps = avm({ estimatedValue: 875_005, lowBand: 773_000, highBand: 990_000 });
    const c = detectCompetitive(list, comps, "Toronto C12")!;
    expect(c.rangeHigh).toBeLessThan(875_005);
    expect(c.closeVsCompMid).toBeLessThan(0.9);
    expect(c.reachedCompMid).toBeLessThan(0.1);
  });

  it("never fires on the AVM-fallback path (no live list-anchor)", () => {
    const list = 999_000;
    const r = resolveSalePrice({ listPrice: list, isActive: false, expectedSale: null, estimate: underComps, city: "Toronto C12" })!;
    expect(r.source).toBe("avm");
    expect(r.competitive).toBeNull();
  });

  it("fires on C13806756 — the $688,000 Toronto ask the old digit gate threw away", () => {
    // 69 Upper Canada Dr #3, Toronto C12: 3+1 bed / 3 bath condo townhouse asking $688,000
    // while size-matched St. Andrew-Windfields comps ran ~$961,000 (n=10, 24mo, sales only).
    // The old gate tested 688000 % 100000 >= 95000 -> 88000 >= 95000 -> false, and returned
    // before ever comparing the ask to the comps.
    const list = 688_000;
    const comps = avm({ estimatedValue: 961_000, lowBand: 880_000, highBand: 1_040_000 });
    expect(isThresholdPrice(list)).toBe(false); // the old gate still says no...
    const c = detectCompetitive(list, comps, "Toronto C12")!; // ...but the pattern table does not
    expect(c.pattern).toBe("lucky-88");
    expect(c.market).toBe("gta");
    // Range is now measured: ask x the median and p75 close/list for a ~40% comp gap in the
    // GTA. It is NOT the ask-to-comp-low band the card used to print.
    const band = competitiveOutcomeFor("gta", 961_000 / list - 1)!;
    expect(c.rangeLow).toBe(Math.round(list * band.medianCloseRatio));
    expect(c.rangeHigh).toBe(Math.round(list * band.p75CloseRatio));
    expect(c.likelyClose).toBe(c.rangeLow);
    expect(c.belowCompsPct).toBeCloseTo((961_000 - list) / 961_000, 6);
    // And it must not read as a promise the home reaches the comp estimate.
    expect(c.rangeHigh).toBeLessThan(961_000);
  });

  it("withholds the lucky-88 call on the same ask outside the GTA", () => {
    const comps = avm({ estimatedValue: 961_000, lowBand: 880_000, highBand: 1_040_000 });
    expect(detectCompetitive(688_000, comps, "London")).toBeNull();
  });

  it("detectCompetitive (exported) matches what resolveSalePrice embeds — one detector, no drift", () => {
    const list = 999_000;
    const viaResolver = resolveSalePrice({ listPrice: list, isActive: true, expectedSale: es(list), estimate: underComps, city: "Toronto C12" })!;
    expect(detectCompetitive(list, underComps, "Toronto C12")).toEqual(viaResolver.competitive);
    expect(detectCompetitive(list, null, "Toronto C12")).toBeNull();
  });
});
