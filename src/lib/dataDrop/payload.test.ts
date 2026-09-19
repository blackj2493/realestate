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
  withoutSpikes,
  provinceLead,
  
  
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

describe("one-day glitches vs real step changes", () => {
  // Every series below is the REAL province trueDom history, inventory-weighted.
  const day = (d: number) => `2026-09-${String(d).padStart(2, "0")}`;

  it("does not let a one-night glitch void the month behind it", () => {
    // 2026-09-10 read 40.1 between two nights of ~66. hasDiscontinuity saw a 40% jump and
    // voided every prior whose window spanned it — which disabled leverage, speed AND
    // supply for 28 days and dropped the ladder to its price fallback for 305 of 321
    // recipients on 2026-09-17.
    const list = [
      { day: day(8), value: 58.7 },
      { day: day(9), value: 66.8 },
      { day: day(10), value: 40.1 }, // the glitch
      { day: day(11), value: 65.3 },
      { day: day(12), value: 65.3 },
    ];
    expect(hasDiscontinuity(list, day(8), Date.parse(`${day(12)}T00:00:00Z`))).toBe(false);
    expect(withoutSpikes(list).map((p) => p.value)).toEqual([58.7, 66.8, 65.3, 65.3]);
  });

  it("still catches the 2026-08-14 methodology break", () => {
    // The real one: #344/#345 shipped feed-verified liveness and the level MOVED and STAYED.
    // This must keep voiding priors — the old and new numbers are not comparable.
    const list = [
      { day: "2026-08-12", value: 107.6 },
      { day: "2026-08-13", value: 108.6 },
      { day: "2026-08-14", value: 63.9 },
      { day: "2026-08-15", value: 63.8 },
      { day: "2026-08-17", value: 64.5 },
    ];
    expect(
      hasDiscontinuity(list, "2026-08-12", Date.parse("2026-08-17T00:00:00Z"))
    ).toBe(true);
    // And the step is NOT mistaken for a spike — nothing is filtered out.
    expect(withoutSpikes(list)).toHaveLength(list.length);
  });

  it("drops the near-zero dropout too", () => {
    // 2026-08-16 read 1.4 between 63.8 and 64.5.
    const list = [
      { day: "2026-08-15", value: 63.8 },
      { day: "2026-08-16", value: 1.4 },
      { day: "2026-08-17", value: 64.5 },
    ];
    expect(withoutSpikes(list).map((p) => p.value)).toEqual([63.8, 64.5]);
    expect(
      hasDiscontinuity(list, "2026-08-15", Date.parse("2026-08-17T00:00:00Z"))
    ).toBe(false);
  });

  it("will not explain away a two-stage shift", () => {
    // Neighbours must agree before the middle reading is called a glitch; a level that
    // walks 100 -> 70 -> 45 is a real move, not one bad night.
    const list = [
      { day: day(8), value: 100 },
      { day: day(9), value: 70 },
      { day: day(10), value: 45 },
    ];
    expect(withoutSpikes(list)).toHaveLength(3);
    expect(hasDiscontinuity(list, day(8), Date.parse(`${day(10)}T00:00:00Z`))).toBe(true);
  });

  it("does not judge a reading across a coverage gap", () => {
    // The canary can miss nights. A neighbour a week away cannot vouch for anything.
    const list = [
      { day: "2026-09-01", value: 66 },
      { day: "2026-09-09", value: 40 },
      { day: "2026-09-17", value: 65 },
    ];
    expect(withoutSpikes(list)).toHaveLength(3);
  });

  it("never anchors a prior to a glitch", () => {
    // The other half of the damage: picking 40.1 as "a month ago" would have invented a
    // 60% improvement out of a bad night.
    const idx = new Map([
      [
        "Ontario:trueDom",
        [
          { day: "2026-08-20", value: 65.0 },
          { day: "2026-08-21", value: 40.1 }, // glitch nearest the 28-day target
          { day: "2026-08-22", value: 64.0 },
          { day: "2026-09-18", value: 53.5 },
        ],
      ],
    ]);
    const prior = priorValue(idx, "Ontario", "trueDom", Date.parse("2026-09-18T00:00:00Z"));
    expect(prior).not.toBeNull();
    expect(prior!.value).not.toBe(40.1);
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
  it("leads a reader who saved nothing with the best story on the board", () => {
    // Measured on the 2026-09-17 send, 305 of 321 recipients led with the rank-7 `price`
    // fallback, because the Ontario aggregate's own 28-day moves sit under thresholds
    // calibrated for one market. A reader who picked no market now gets the board's
    // headline instead: a fact about a place rather than a fact about our arithmetic.
    const res = buildDataDropPayload({ ...base, regions: [] });
    expect(res?.payload.scope).toBe("province");
    expect(res?.payload.region).not.toBe("Ontario");
    expect(res?.payload.headline.kind).not.toBe("price");
  });

  it("keeps the whole conversion path on a market-led province send", () => {
    // scope stays "province" so the renderer still emits the tension block, the market
    // chips and the spread. Leading with a market must not cost the ask.
    const res = buildDataDropPayload({ ...base, regions: [] });
    expect(res?.payload.scope).toBe("province");
    // Highest and lowest of the fixture's competition cells, with Ontario as the midpoint.
    expect(res?.payload.spread?.high.region).toBe("Milton");
    expect(res?.payload.spread?.low.region).toBe("Hamilton");
    expect(res?.payload.spread?.mid?.pct).toBe(18);
  });

  it("uses the aggregate when no single market has news", () => {
    // provinceLead excludes the price rung on purpose: "a typical Ajax home sold for $X" is
    // the same dull sentence as the province median with a narrower denominator. When the
    // board has no news, the aggregate IS the honest thing to send.
    const flat = base.rows.map((r) => ({ ...r, trueDom: null, activeCount: r.activeCount }));
    const res = buildDataDropPayload({
      ...base,
      regions: [],
      rows: flat,
      competitionByCity: new Map(),
      snapshots: new Map(),
    });
    expect(res?.payload.scope).toBe("province");
    expect(res?.payload.region).toBe("Ontario");
    expect(res?.payload.headline.kind).toBe("price");
  });

  it("its rows describe the same place as its headline", () => {
    // A headline about Ajax over rows about Ontario is two emails in one envelope.
    const res = buildDataDropPayload({ ...base, regions: [] });
    const led = provinceLead({ ...base, regions: [] });
    expect(led).not.toBeNull();
    expect(res?.payload.region).toBe(led!.region);
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
