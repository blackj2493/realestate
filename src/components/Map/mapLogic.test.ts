import { describe, it, expect } from "vitest";
import {
  clusterRadiusForZoom,
  hasMetricValue,
  scatterColorFor,
  NO_DATA_COLOR,
  pickRepresentativePins,
} from "./mapLogic";
describe("clusterRadiusForZoom", () => {
  it("is tighter when zoomed out (don't blob a city), looser when zoomed in", () => {
    expect(clusterRadiusForZoom(11)).toBeLessThan(64);
    expect(clusterRadiusForZoom(11)).toBeLessThanOrEqual(clusterRadiusForZoom(16));
  });
});

const RANGE: [number, number, number][] = [
  [13, 42, 33], [6, 78, 59], [4, 120, 87], [16, 185, 129], [52, 211, 153], [134, 239, 172],
];

describe("hasMetricValue", () => {
  it("non-sparse: any finite value counts (0 is legitimate)", () => {
    expect(hasMetricValue(0, false)).toBe(true);
    expect(hasMetricValue(5, false)).toBe(true);
    expect(hasMetricValue(0, undefined)).toBe(true);
  });
  it("sparse: only positive finite values count (0/NaN = no estimate)", () => {
    expect(hasMetricValue(5, true)).toBe(true);
    expect(hasMetricValue(0, true)).toBe(false);
    expect(hasMetricValue(NaN, true)).toBe(false);
    expect(hasMetricValue(-2, true)).toBe(false);
  });
});

describe("scatterColorFor", () => {
  it("sparse no-estimate → NO_DATA_COLOR (not the low band)", () => {
    expect(scatterColorFor(0, [0, 10], RANGE, true)).toBe(NO_DATA_COLOR);
  });
  it("sparse with a real value → ramp color", () => {
    expect(scatterColorFor(6, [0, 10], RANGE, true)).toBe(RANGE[3]); // colorIndexFor(6,[0,10],6)=3
  });
  it("non-sparse value 0 → ramp low band (unchanged behavior)", () => {
    expect(scatterColorFor(0, [0, 10], RANGE, false)).toBe(RANGE[0]);
  });
});

describe("pickRepresentativePins", () => {
  type Pin = { lng: number; lat: number; price: number; fresh: number };
  const opts = (cols: number, rows: number, perCell: number) => ({
    cols,
    rows,
    perCell,
    getLngLat: (p: Pin) => [p.lng, p.lat] as [number, number],
    getPrice: (p: Pin) => p.price,
    getFreshness: (p: Pin) => p.fresh,
  });

  it("returns input unchanged when empty or a cell holds ≤ perCell", () => {
    expect(pickRepresentativePins<Pin>([], opts(8, 6, 2))).toEqual([]);
    const two: Pin[] = [
      { lng: -79.4, lat: 43.6, price: 100, fresh: 1 },
      { lng: -79.4, lat: 43.6, price: 200, fresh: 2 },
    ];
    expect(pickRepresentativePins(two, opts(8, 6, 2))).toEqual(two);
  });

  it("caps a crowded cell and drops the price outliers, keeping the median", () => {
    // Four coincident points → one cell. perCell=1 keeps only the median-priced.
    const group: Pin[] = [
      { lng: -79.4, lat: 43.6, price: 100, fresh: 4 },
      { lng: -79.4, lat: 43.6, price: 200, fresh: 3 },
      { lng: -79.4, lat: 43.6, price: 300, fresh: 2 },
      { lng: -79.4, lat: 43.6, price: 9000, fresh: 1 }, // outlier
    ];
    const kept = pickRepresentativePins(group, opts(8, 6, 1));
    expect(kept).toHaveLength(1);
    expect(kept[0].price).toBe(200); // sorted[floor((4-1)/2)] = 200, NOT the 9000 outlier
  });

  it("perCell=2 keeps the median AND the freshest, still excluding the extremes", () => {
    const group: Pin[] = [
      { lng: -79.4, lat: 43.6, price: 100, fresh: 1 },
      { lng: -79.4, lat: 43.6, price: 200, fresh: 2 },
      { lng: -79.4, lat: 43.6, price: 300, fresh: 5 }, // freshest
      { lng: -79.4, lat: 43.6, price: 9000, fresh: 0 }, // priciest, stalest
    ];
    const kept = pickRepresentativePins(group, opts(8, 6, 2));
    const prices = kept.map((p) => p.price).sort((a, b) => a - b);
    expect(prices).toEqual([200, 300]); // median + freshest; 100 & 9000 dropped
  });

  it("spreads across cells — points in distinct cells are all kept", () => {
    // Three points far apart span three different grid cells, so each is alone.
    const spread: Pin[] = [
      { lng: -79.5, lat: 43.6, price: 500, fresh: 1 },
      { lng: -79.0, lat: 43.8, price: 9999, fresh: 2 }, // an outlier, but alone → kept
      { lng: -78.5, lat: 44.0, price: 700, fresh: 3 },
    ];
    expect(pickRepresentativePins(spread, opts(8, 6, 1))).toHaveLength(3);
  });
});
