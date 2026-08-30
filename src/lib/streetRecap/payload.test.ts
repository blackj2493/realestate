import { describe, expect, it } from "vitest";
import {
  buildStreetRecapPayload,
  printableTypes,
  domVerdict,
  previousMonthWindow,
  MIN_SALES,
  MIN_ACTIVES,
  type SoldAgg,
  type RecapScope,
  type BuildInput,
} from "./payload";

const NOW = Date.parse("2026-09-15T12:00:00Z");

const sold = (over: Partial<SoldAgg> = {}): SoldAgg => ({
  sales: 40,
  aboveAsking: 8,
  medianDom: 18,
  byType: [],
  ...over,
});

const scope = (kind: RecapScope["kind"], label: string): RecapScope => ({
  kind,
  label,
  city: "Vaughan",
});

const input = (over: Partial<BuildInput> = {}): BuildInput => ({
  address: "128 Maplecrest Ave",
  candidates: [
    { scope: scope("region", "Patterson"), sold: sold() },
    { scope: scope("fsa", "L6A"), sold: sold({ sales: 120 }) },
  ],
  city: { scope: scope("city", "Vaughan"), sold: sold({ sales: 686, aboveAsking: 116, medianDom: 21 }) },
  actives: { active: 1482, cutPrice: 382, medianTrueDom: 63 },
  dataAsOf: "2026-09-15T04:00:00Z",
  monthLabel: "August",
  ...over,
});

describe("the scope ladder", () => {
  it("takes the tightest cohort that clears the floor", () => {
    const p = buildStreetRecapPayload(input())!;
    // "Patterson" is where they live; "Vaughan" is an administrative fact about them.
    expect(p.scope.label).toBe("Patterson");
    expect(p.scope.kind).toBe("region");
  });

  it("falls through a thin neighbourhood to the next rung", () => {
    const p = buildStreetRecapPayload(
      input({
        candidates: [
          { scope: scope("region", "Patterson"), sold: sold({ sales: MIN_SALES - 1 }) },
          { scope: scope("fsa", "L6A"), sold: sold({ sales: 120 }) },
        ],
      })
    )!;
    expect(p.scope.label).toBe("L6A");
  });

  it("falls all the way to the city when every tighter cohort is thin", () => {
    const p = buildStreetRecapPayload(
      input({ candidates: [{ scope: scope("region", "Patterson"), sold: sold({ sales: 2 }) }] })
    )!;
    expect(p.scope.kind).toBe("city");
    // Nothing to compare a city against — it IS the comparison.
    expect(p.cityAgg).toBeNull();
    expect(p.cityAbovePct).toBeNull();
  });

  it("returns null rather than publish a recap the city itself cannot support", () => {
    // Three sales is not a quiet month; it is a number that should not be printed.
    expect(
      buildStreetRecapPayload(
        input({
          candidates: [{ scope: scope("region", "Nowhere"), sold: sold({ sales: 1 }) }],
          city: { scope: scope("city", "Vaughan"), sold: sold({ sales: 3 }) },
        })
      )
    ).toBeNull();
  });
});

describe("derived shares", () => {
  it("computes local and city above-asking shares", () => {
    const p = buildStreetRecapPayload(input())!;
    expect(p.abovePct).toBe(20); // 8 of 40
    expect(p.cityAbovePct).toBe(16.9); // 116 of 686
  });

  it("drops the standing-inventory line below the actives floor", () => {
    const p = buildStreetRecapPayload(
      input({ actives: { active: MIN_ACTIVES - 1, cutPrice: 2, medianTrueDom: 50 } })
    )!;
    expect(p.actives).toBeNull();
    expect(p.cutPct).toBeNull();
  });

  it("never divides by zero", () => {
    const p = buildStreetRecapPayload(
      input({
        candidates: [{ scope: scope("region", "Patterson"), sold: sold({ sales: 6, aboveAsking: 0 }) }],
        actives: { active: 100, cutPrice: 0, medianTrueDom: 40 },
      })
    )!;
    expect(p.abovePct).toBe(0);
    expect(p.cutPct).toBe(0);
  });
});

describe("printableTypes", () => {
  it("keeps the three biggest cohorts that clear the floor", () => {
    const rows = [
      { type: "Detached", sales: 100, medianDom: 17 },
      { type: "Att/Row/Townhouse", sales: 38, medianDom: 14 },
      { type: "Condo Apartment", sales: 13, medianDom: 40 },
      { type: "Semi-Detached", sales: 11, medianDom: 15 },
      { type: "Link", sales: 2, medianDom: 9 },
    ];
    const out = printableTypes(rows);
    expect(out.map((r) => r.type)).toEqual(["Detached", "Att/Row/Townhouse", "Condo Apartment"]);
  });

  it("drops a type with no median rather than rendering a dash", () => {
    expect(printableTypes([{ type: "Detached", sales: 40, medianDom: null }])).toEqual([]);
  });
});

describe("domVerdict", () => {
  it("reports the gap when it is worth a sentence", () => {
    const p = buildStreetRecapPayload(input())!; // local 18, city 21
    expect(domVerdict(p)).toEqual({ faster: true, gapDays: 3 });
  });

  it("says nothing when the two are within the noise", () => {
    const p = buildStreetRecapPayload(
      input({
        candidates: [{ scope: scope("region", "Patterson"), sold: sold({ medianDom: 20 }) }],
      })
    )!;
    expect(domVerdict(p)).toBeNull();
  });

  it("is null when there is no city to compare against", () => {
    const p = buildStreetRecapPayload(
      input({ candidates: [{ scope: scope("region", "Patterson"), sold: sold({ sales: 1 }) }] })
    )!;
    expect(domVerdict(p)).toBeNull();
  });
});

describe("previousMonthWindow", () => {
  it("returns calendar DATES, not instants", () => {
    const w = previousMonthWindow(NOW); // 2026-09-15
    // close_date is a `date`; a timestamptz bound would be cast to midnight in the SERVER
    // timezone and silently drop the 1st of the month through EDT.
    expect(w.from).toBe("2026-08-01");
    expect(w.to).toBe("2026-09-01");
    expect(w.key).toBe("2026-08");
    expect(w.label).toBe("August");
  });

  it("resolves the month in Toronto, not UTC", () => {
    // 00:30 UTC on September 1 is still 20:30 on August 31 in Toronto, so the previous
    // month is JULY for the reader even though the server has already rolled over.
    const w = previousMonthWindow(Date.parse("2026-09-01T00:30:00Z"));
    expect(w.label).toBe("July");
    expect(w.from).toBe("2026-07-01");
    expect(w.to).toBe("2026-08-01");
  });

  it("rolls the year back in January", () => {
    const w = previousMonthWindow(Date.parse("2026-01-14T17:00:00Z"));
    expect(w.from).toBe("2025-12-01");
    expect(w.to).toBe("2026-01-01");
    expect(w.label).toBe("December");
  });
});

/**
 * The city rollup is optional. address_watches holds the GEOCODER's municipality and the
 * feed holds TRREB's — Strathroy against "Adelaide Metcalfe", Toronto against
 * "Toronto C01" — so requiring one skipped every real recipient on the first live dry run.
 */
describe("no city rollup", () => {
  it("builds from the FSA cohort alone", () => {
    const p = buildStreetRecapPayload(
      input({
        candidates: [{ scope: scope("fsa", "M5A"), sold: sold({ sales: 64, medianDom: 29 }) }],
        city: null,
      })
    )!;
    expect(p.scope.kind).toBe("fsa");
    expect(p.local.sales).toBe(64);
    expect(p.cityAgg).toBeNull();
    expect(p.cityAbovePct).toBeNull();
    // Nothing to compare against, so no verdict is invented.
    expect(domVerdict(p)).toBeNull();
  });

  it("returns null when there is neither a cohort nor a city", () => {
    expect(
      buildStreetRecapPayload(
        input({ candidates: [{ scope: scope("fsa", "M5A"), sold: sold({ sales: 2 }) }], city: null })
      )
    ).toBeNull();
  });
});
