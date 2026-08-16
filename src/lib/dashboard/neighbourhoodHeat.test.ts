import { describe, it, expect } from "vitest";
import {
  aggregateCommunities,
  hasUsableHeat,
  MIN_COMMUNITY_N,
  type HeatInput,
} from "./neighbourhoodHeat";

const item = (region: string, cap: number | null, extra: Partial<HeatInput> = {}): HeatInput => ({
  region,
  cap,
  dom: null,
  drop: null,
  price: null,
  lat: 43.7,
  lng: -79.7,
  ...extra,
});

/** n copies of one community with the given cap values. */
const community = (region: string, caps: number[]) => caps.map((c) => item(region, c));

describe("aggregateCommunities", () => {
  it("ranks communities by median, floor-gated at MIN_COMMUNITY_N listings", () => {
    const stats = aggregateCommunities([
      ...community("Sandringham-Wellington", [5.0, 5.1, 4.9, 5.0, 5.2, 4.8]),
      ...community("Fletcher's West", [4.5, 4.6, 4.4, 4.7, 4.5]),
      // The old failure mode: a lone 8.1% listing must NOT top the board.
      ...community("Northwood Park", [8.1, 8.0]),
    ]);
    expect(stats.cap.map((r) => r.name)).toEqual(["Sandringham-Wellington", "Fletcher's West"]);
    expect(stats.cap[0].median).toBe(5.0);
    expect(stats.cap[0].count).toBe(6);
    expect(stats.analyzed).toBe(13);
  });

  it(`drops communities below ${MIN_COMMUNITY_N} listings but returns EVERY qualifier, ranked`, () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      community(`Area ${i}`, [3 + i, 3 + i, 3 + i, 3 + i, 3 + i])
    ).flat();
    const stats = aggregateCommunities([...many, ...community("Thin", [9, 9, 9, 9])]);
    // The full ranking comes back (the client collapses to its teaser view) — a
    // truncated list would make "where does MY community rank?" unanswerable.
    expect(stats.cap).toHaveLength(8);
    expect(stats.cap.find((r) => r.name === "Thin")).toBeUndefined();
    expect(stats.cap[0].name).toBe("Area 7"); // highest median leads
    expect(stats.cap[7].name).toBe("Area 0"); // ...down to the lowest qualifier
  });

  it("ranks median asking price as its own lens", () => {
    const priced = (region: string, prices: number[]) =>
      prices.map((p) => item(region, null, { price: p }));
    const stats = aggregateCommunities([
      ...priced("Premium Pocket", [1_200_000, 1_250_000, 1_180_000, 1_300_000, 1_220_000]),
      ...priced("Value Pocket", [740_000, 760_000, 755_000, 750_000, 745_000]),
    ]);
    expect(stats.price.map((r) => r.name)).toEqual(["Premium Pocket", "Value Pocket"]);
    expect(stats.price[0].median).toBe(1_220_000);
    expect(stats.price[1].median).toBe(750_000);
    expect(stats.cap).toEqual([]); // no cap data in this set
  });

  it("computes the deep-link centroid from contributing listings only", () => {
    const stats = aggregateCommunities([
      item("A", 5, { lat: 43.0, lng: -79.0 }),
      item("A", 5, { lat: 44.0, lng: -80.0 }),
      item("A", 5),
      item("A", 5),
      item("A", 5, { lat: null, lng: null }), // no geo — still counts, skips centroid
    ]);
    const a = stats.cap[0];
    expect(a.count).toBe(5);
    expect(a.lat).toBeCloseTo((43.0 + 44.0 + 43.7 + 43.7) / 4, 6);
    expect(a.lng).toBeCloseTo((-79.0 - 80.0 - 79.7 - 79.7) / 4, 6);
  });

  it("each metric ranks independently (a community can lead one and miss another)", () => {
    const items: HeatInput[] = [
      ...community("Yieldville", [6, 6, 6, 6, 6]),
      ...Array.from({ length: 5 }, () => item("Staleton", null, { dom: 60 })),
    ];
    const stats = aggregateCommunities(items);
    expect(stats.cap.map((r) => r.name)).toEqual(["Yieldville"]);
    expect(stats.dom.map((r) => r.name)).toEqual(["Staleton"]);
    expect(stats.drop).toEqual([]);
  });

  it("ignores zero/negative/non-finite values and blank community names", () => {
    const stats = aggregateCommunities([
      ...community("Real", [5, 5, 5, 5, 5]),
      item("Real", 0),
      item("Real", -2),
      item("Real", Number.NaN),
      item("", 7),
      item("  ", 7),
    ]);
    expect(stats.cap[0].count).toBe(5);
    expect(stats.cap).toHaveLength(1);
  });
});

describe("hasUsableHeat", () => {
  it("true only when some metric fields 3+ qualifying communities", () => {
    const thin = aggregateCommunities([
      ...community("A", [5, 5, 5, 5, 5]),
      ...community("B", [4, 4, 4, 4, 4]),
    ]);
    expect(hasUsableHeat(thin)).toBe(false);
    const ok = aggregateCommunities([
      ...community("A", [5, 5, 5, 5, 5]),
      ...community("B", [4, 4, 4, 4, 4]),
      ...community("C", [3, 3, 3, 3, 3]),
    ]);
    expect(hasUsableHeat(ok)).toBe(true);
  });
});
