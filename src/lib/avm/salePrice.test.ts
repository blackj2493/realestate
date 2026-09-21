import { describe, it, expect } from "vitest";
import {
  resolveSalePrice,
  detectCompetitive,
  RATIO_HIGH_CONFIDENCE_N,
  SALE_BAND_HALF_WIDTH,
  isThresholdPrice,
  matchCompetitivePattern,
  competitiveMarketOf,
  COMPETITIVE_PATTERNS,
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

describe("COMPETITIVE_PATTERNS · per-market rates", () => {
  it("gives every pattern at least one measured market, with sane rates", () => {
    expect(COMPETITIVE_PATTERNS.length).toBeGreaterThan(0);
    for (const p of COMPETITIVE_PATTERNS) {
      const measured = Object.values(p.rates).filter((r) => r !== null);
      expect(measured.length).toBeGreaterThan(0); // a pattern with no measured market is dead code
      for (const r of measured) {
        expect(r!.overAskRate).toBeGreaterThan(0);
        expect(r!.overAskRate).toBeLessThan(1);
        expect(r!.medianCloseRatio).toBeGreaterThan(0.8);
        expect(r!.medianCloseRatio).toBeLessThan(1.2);
      }
    }
  });

  it("keeps pattern names unique", () => {
    const names = COMPETITIVE_PATTERNS.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("maps TRREB district strings and regional municipalities to the gta market", () => {
    // Toronto never arrives bare — it is always a district code (memory: trreb-city-taxonomy).
    expect(competitiveMarketOf("Toronto C12")).toBe("gta");
    expect(competitiveMarketOf("Toronto W05")).toBe("gta");
    expect(competitiveMarketOf("Markham")).toBe("gta");
    expect(competitiveMarketOf("Oakville")).toBe("gta");
  });

  it("treats everything else — and a missing city — as the conservative other market", () => {
    expect(competitiveMarketOf("Ottawa")).toBe("other");
    expect(competitiveMarketOf("London")).toBe("other");
    expect(competitiveMarketOf(null)).toBe("other");
    expect(competitiveMarketOf("")).toBe("other");
    expect(competitiveMarketOf(undefined)).toBe("other");
  });

  it("publishes a LOWER over-ask rate outside the GTA for the same ask shape", () => {
    // The whole point of splitting the table: 54.5% vs 22.5% on the same "999" pattern.
    const gta = matchCompetitivePattern(999_000, "gta")!;
    const other = matchCompetitivePattern(999_000, "other")!;
    expect(gta.name).toBe("threshold");
    expect(other.name).toBe("threshold");
    expect(other.rates.overAskRate).toBeLessThan(gta.rates.overAskRate);
  });

  it("recognises the lucky-88 ask in the GTA and withholds it elsewhere", () => {
    // $688,000 -> remainder $88,000. The ask that started this: the old single-pattern gate
    // discarded it before the comp test ran.
    expect(matchCompetitivePattern(688_000, "gta")?.name).toBe("lucky-88");
    expect(matchCompetitivePattern(1_288_800, "gta")?.name).toBe("lucky-88");
    // Only 17 non-GTA closings matched — too thin to publish a probability, so it stays silent.
    expect(matchCompetitivePattern(688_000, "other")).toBeNull();
  });

  it("returns null for a non-matching or invalid ask", () => {
    expect(matchCompetitivePattern(1_250_000, "gta")).toBeNull(); // mid-band
    expect(matchCompetitivePattern(0, "gta")).toBeNull();
    expect(matchCompetitivePattern(-1, "gta")).toBeNull();
  });

  it("the payload quotes the FIRED pattern+market rates, never a pooled constant", () => {
    const under = avm({ estimatedValue: 1_258_000, lowBand: 1_180_000, highBand: 1_340_000 });
    for (const [city, market] of [["Toronto C12", "gta"], ["London", "other"]] as const) {
      const c = detectCompetitive(999_000, under, city)!;
      const fired = matchCompetitivePattern(999_000, market)!;
      expect(c.market).toBe(market);
      expect(c.overAskRate).toBe(fired.rates.overAskRate);
      expect(c.medianCloseRatio).toBe(fired.rates.medianCloseRatio);
    }
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
    expect(r.competitive!.rangeLow).toBe(list); // floor = the ask
    expect(r.competitive!.rangeHigh).toBe(1_180_000); // comp low (it clears the ask)
    expect(r.competitive!.pattern).toBe("threshold");
    expect(r.competitive!.overAskRate).toBe(matchCompetitivePattern(list, "gta")!.rates.overAskRate);
    expect(r.competitive!.belowCompsPct).toBeCloseTo((1_258_000 - list) / 1_258_000, 6);
    // The bucket's measured median close/list rides along so every consumer (offer band,
    // The Read) anchors "likely close" to the SAME calibration.
    expect(r.competitive!.medianCloseRatio).toBe(
      matchCompetitivePattern(list, "gta")!.rates.medianCloseRatio,
    );
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

  it("uses the comp mid as the range ceiling when the comp low is still below the ask", () => {
    const list = 999_000;
    const r = resolveSalePrice({
      listPrice: list,
      isActive: true,
      expectedSale: es(list),
      estimate: avm({ estimatedValue: 1_100_000, lowBand: 980_000, highBand: 1_220_000 }),
      city: "Toronto C12",
    })!;
    expect(r.competitive!.rangeHigh).toBe(1_100_000); // comp low (980k) ≤ ask → fall back to mid
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
    expect(c.rangeLow).toBe(list);
    expect(c.rangeHigh).toBe(880_000); // comp low clears the ask
    expect(c.belowCompsPct).toBeCloseTo((961_000 - list) / 961_000, 6);
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
