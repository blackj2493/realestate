import { describe, expect, it } from "vitest";
import {
  buildDataDropPayload,
  computeSpread,
  hasDiscontinuity,
  indexSnapshots,
  isoWeekId,
  pickHeadline,
  priorValue,
  synthesizeProvinceSnapshots,
  type SnapshotEntry,
} from "./payload";
import type { MarketRow } from "@/lib/data/marketBoard";
import type { CompetitionRow } from "@/lib/data/competitionBoard";

const DAY = 86_400_000;
const NOW = Date.parse("2026-08-28T12:00:00Z");
const day = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString().slice(0, 10);

function marketRow(over: Partial<MarketRow> = {}): MarketRow {
  return {
    region: "Milton",
    medianPrice: 900_000,
    avgPrice: 950_000,
    yoyPct: -2.1,
    medianPpsf: 600,
    activeCount: 400,
    monthsOfSupply: 4,
    soldToListPct: 98,
    trueDom: 40,
    medianNaiveDom: 30,
    soldMedianDom: 35,
    soldP25Dom: 20,
    soldP75Dom: 60,
    sellThroughPct: 20,
    stalePct: 10,
    temperature: "balanced" as MarketRow["temperature"],
    priceSeries: [],
    cutShare: 0.25,
    cutCount: 100,
    cutActive: 400,
    medianCutPct: 3,
    medianCutAmt: 40_000,
    domBuckets: null,
    rentalRows: [],
    ...over,
  };
}

function comp(over: Partial<CompetitionRow> = {}): CompetitionRow {
  return {
    city: "Milton",
    area: "",
    group: "House",
    pctOverAsk: 40,
    pctAtAsk: 10,
    pctUnderAsk: 50,
    medianSaleToList: 99,
    medianPremium: 20_000,
    medianDiscount: 15_000,
    pctCutBeforeSale: 30,
    yoyOverAskPts: -2,
    sampleCount: 200,
    priorSample: 180,
    ...over,
  };
}

/** A clean, gently-drifting series — no methodology break. */
const smooth = (region: string, metric: string, from: number, to: number, days = 40): SnapshotEntry[] =>
  Array.from({ length: days }, (_, k) => ({
    region,
    metric,
    captured_on: day(days - 1 - k),
    value: from + ((to - from) * k) / (days - 1),
  }));

describe("isoWeekId", () => {
  it("is stable within a week and changes across one", () => {
    const thu = Date.parse("2026-08-27T12:00:00Z");
    expect(isoWeekId(thu)).toBe(isoWeekId(thu + 2 * DAY));
    expect(isoWeekId(thu)).not.toBe(isoWeekId(thu + 7 * DAY));
  });
});

describe("priorValue", () => {
  const idx = indexSnapshots(smooth("Milton", "cutSharePct", 16, 25));

  it("finds the reading nearest 28 days back", () => {
    const p = priorValue(idx, "Milton", "cutSharePct", NOW);
    expect(p).not.toBeNull();
    expect(p!.day).toBe(day(28));
  });

  it("returns null for a metric with no history", () => {
    expect(priorValue(idx, "Milton", "trueDom", NOW)).toBeNull();
  });

  it("returns null when the nearest reading is outside the tolerance window", () => {
    const sparse = indexSnapshots([
      { region: "Milton", metric: "x", captured_on: day(300), value: 10 },
    ]);
    expect(priorValue(sparse, "Milton", "x", NOW)).toBeNull();
  });

  // The 2026-08-14 incident in miniature: #344/#345 shipped feed-verified liveness and
  // trueDom stepped 107 -> 62 across every market in one night. Comparing across that
  // describes a deploy, not the market.
  it("refuses a comparison whose window contains a methodology break", () => {
    const series = [
      ...smooth("Milton", "trueDom", 100, 107, 20).slice(0, 20),
      ...Array.from({ length: 14 }, (_, k) => ({
        region: "Milton",
        metric: "trueDom",
        captured_on: day(13 - k),
        value: 62,
      })),
    ];
    expect(priorValue(indexSnapshots(series), "Milton", "trueDom", NOW)).toBeNull();
  });
});

describe("hasDiscontinuity", () => {
  it("is false for a smooth series", () => {
    const list = [
      { day: day(30), value: 100 },
      { day: day(29), value: 102 },
      { day: day(28), value: 104 },
    ].sort((a, b) => a.day.localeCompare(b.day));
    expect(hasDiscontinuity(list, list[0].day, NOW)).toBe(false);
  });

  it("is true across an overnight step", () => {
    const list = [
      { day: day(30), value: 107 },
      { day: day(29), value: 62 },
    ].sort((a, b) => a.day.localeCompare(b.day));
    expect(hasDiscontinuity(list, list[0].day, NOW)).toBe(true);
  });

  it("does not treat a gap in coverage as a jump", () => {
    // The canary missed a week; the value legitimately drifted while nobody was writing.
    const list = [
      { day: day(30), value: 100 },
      { day: day(20), value: 140 },
    ].sort((a, b) => a.day.localeCompare(b.day));
    expect(hasDiscontinuity(list, list[0].day, NOW)).toBe(false);
  });
});

describe("the headline ladder", () => {
  const snaps = indexSnapshots([
    ...smooth("Milton", "cutSharePct", 16, 25),
    ...smooth("Milton", "trueDom", 40, 40),
    ...smooth("Milton", "activeCount", 400, 400),
  ]);

  it("leads with rank 1 when the over-ask rate crossed 50%", () => {
    const res = pickHeadline({
      region: "Milton",
      row: marketRow(),
      competition: comp({ pctOverAsk: 47, yoyOverAskPts: -6 }), // prior 53 -> crossed
      snapshots: snaps,
      now: NOW,
    });
    expect(res?.headline.kind).toBe("over_ask_flip");
  });

  it("falls to rank 2 when the cut share moved more than 4 points", () => {
    const res = pickHeadline({
      region: "Milton",
      row: marketRow(),
      competition: comp(), // 40% over ask, no crossing, yoy under the rank-5 threshold
      snapshots: snaps,
      now: NOW,
    });
    expect(res?.headline.kind).toBe("leverage");
    expect(res?.headline.figure).toBe("25");
  });

  it("skips rank 2 when the move is under the threshold", () => {
    const flat = indexSnapshots(smooth("Milton", "cutSharePct", 24, 25));
    const res = pickHeadline({
      region: "Milton",
      row: marketRow(),
      competition: comp(),
      snapshots: flat,
      now: NOW,
    });
    expect(res?.headline.kind).not.toBe("leverage");
  });

  it("always resolves to rank 7 when nothing else clears", () => {
    const res = pickHeadline({
      region: "Milton",
      row: marketRow(),
      competition: null,
      snapshots: indexSnapshots([]),
      now: NOW,
    });
    expect(res?.headline.kind).toBe("price");
  });

  it("refuses a market with no price at all rather than inventing one", () => {
    const res = pickHeadline({
      region: "Milton",
      row: marketRow({ medianPrice: null }),
      competition: null,
      snapshots: indexSnapshots([]),
      now: NOW,
    });
    expect(res).toBeNull();
  });

  it("respects the sample floor on the competition ranks", () => {
    const res = pickHeadline({
      region: "Milton",
      row: marketRow({ cutShare: null, medianPrice: null }),
      competition: comp({ pctOverAsk: 47, yoyOverAskPts: -6, sampleCount: 2, priorSample: 2 }),
      snapshots: snaps,
      now: NOW,
    });
    expect(res).toBeNull();
  });
});

describe("computeSpread", () => {
  const cities = (vals: [string, number][]) =>
    new Map(vals.map(([city, pctOverAsk]) => [city, comp({ city, pctOverAsk })]));

  it("returns the extremes and the province midpoint", () => {
    const s = computeSpread(cities([["Hamilton", 10], ["Milton", 22], ["Oshawa", 37]]), 18);
    expect(s?.low).toEqual({ region: "Hamilton", pct: 10 });
    expect(s?.high).toEqual({ region: "Oshawa", pct: 37 });
    expect(s?.mid).toEqual({ region: "Ontario", pct: 18 });
  });

  it("returns null when the gap is too small to be a story", () => {
    expect(computeSpread(cities([["A", 20], ["B", 22], ["C", 25]]), 22)).toBeNull();
  });

  it("returns null with fewer than three markets", () => {
    expect(computeSpread(cities([["A", 10], ["B", 40]]), 20)).toBeNull();
  });
});

describe("synthesizeProvinceSnapshots", () => {
  it("weights rates by inventory and sums counts", () => {
    const entries: SnapshotEntry[] = [
      { region: "A", metric: "activeCount", captured_on: day(1), value: 100 },
      { region: "A", metric: "cutSharePct", captured_on: day(1), value: 10 },
      { region: "B", metric: "activeCount", captured_on: day(1), value: 300 },
      { region: "B", metric: "cutSharePct", captured_on: day(1), value: 30 },
      { region: "C", metric: "activeCount", captured_on: day(1), value: 100 },
      { region: "C", metric: "cutSharePct", captured_on: day(1), value: 10 },
    ];
    const out = synthesizeProvinceSnapshots(entries);
    const active = out.find((e) => e.metric === "activeCount");
    const cuts = out.find((e) => e.metric === "cutSharePct");
    expect(active?.value).toBe(500);
    // (10*100 + 30*300 + 10*100) / 500 = 22
    expect(cuts?.value).toBeCloseTo(22, 6);
  });

  it("skips a day too thin to speak for a province", () => {
    const out = synthesizeProvinceSnapshots([
      { region: "A", metric: "activeCount", captured_on: day(1), value: 100 },
      { region: "B", metric: "activeCount", captured_on: day(1), value: 100 },
    ]);
    expect(out).toHaveLength(0);
  });
});

describe("buildDataDropPayload", () => {
  const base = {
    rows: [marketRow(), marketRow({ region: "Oakville", cutShare: 0.24 })],
    competitionByCity: new Map([
      ["Milton", comp()],
      ["Oakville", comp({ city: "Oakville", pctOverAsk: 38 })],
      ["Hamilton", comp({ city: "Hamilton", pctOverAsk: 10 })],
    ]),
    province: comp({ city: "Ontario", pctOverAsk: 18 }),
    snapshots: indexSnapshots(smooth("Milton", "cutSharePct", 16, 25)),
    dataAsOf: "2026-08-28T00:00:00Z",
    now: NOW,
  };

  it("scopes to a saved market when the reader has one", () => {
    const res = buildDataDropPayload({ ...base, regions: ["Milton"] });
    expect(res?.payload.scope).toBe("market");
    expect(res?.payload.region).toBe("Milton");
    expect(res?.payload.spread).toBeNull();
  });

  // 305 of 432 users have saved nothing, so this is the majority path, not an edge case.
  it("falls back to the province and carries the spread that drives the ask", () => {
    const res = buildDataDropPayload({ ...base, regions: [] });
    expect(res?.payload.scope).toBe("province");
    expect(res?.payload.region).toBe("Ontario");
    // Highest and lowest of the fixture's competition cells, with Ontario as the midpoint.
    expect(res?.payload.spread?.high.region).toBe("Milton");
    expect(res?.payload.spread?.low.region).toBe("Hamilton");
    expect(res?.payload.spread?.mid?.pct).toBe(18);
  });

  it("ignores a saved market the boards do not cover", () => {
    const res = buildDataDropPayload({ ...base, regions: ["Sudbury"] });
    expect(res?.payload.scope).toBe("province");
  });

  it("returns null rather than shipping an email with no numbers", () => {
    const res = buildDataDropPayload({ ...base, regions: [], rows: [] });
    expect(res).toBeNull();
  });

  it("never renders more than three supporting rows", () => {
    const res = buildDataDropPayload({ ...base, regions: ["Milton"] });
    expect(res!.payload.rows.length).toBeLessThanOrEqual(3);
  });
});
