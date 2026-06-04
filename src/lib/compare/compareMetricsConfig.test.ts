import { describe, it, expect } from "vitest";
import {
  COMPARE_METRICS,
  CORE_METRICS,
  extendedGroupMetrics,
  visibleRows,
  resolveRow,
  lensGroupOrder,
  type MetricContext,
} from "./compareMetricsConfig";
import type { ListingDocument } from "@/lib/typesense/client";

const L = (over: Partial<ListingDocument>): ListingDocument =>
  ({ id: "X", ListPrice: 100, location: [0, 0], isDistressed: false, hasSecondarySuitePotential: false, ...over } as ListingDocument);

const ctx = (listing: ListingDocument, isAuthed = true): MetricContext => ({ listing, isAuthed });
const metric = (key: string) => COMPARE_METRICS.find((m) => m.key === key)!;

describe("resolveRow", () => {
  it("locks gated rows for anonymous users (no winner crowned)", () => {
    const r = resolveRow(metric("dealScore"), [ctx(L({}), false), ctx(L({}), false)]);
    expect(r.locked).toEqual([true, true]);
    expect(r.displayed).toEqual([null, null]);
    expect(r.winners.size).toBe(0);
  });

  it("crowns the cheaper List Price with a magnitude gap", () => {
    const r = resolveRow(metric("listPrice"), [ctx(L({ ListPrice: 900000 })), ctx(L({ ListPrice: 800000 }))]);
    expect([...r.winners]).toEqual([1]);
    expect(r.bestVal).toBe(800000);
  });

  it("renders text rows without winners", () => {
    const r = resolveRow(metric("type"), [ctx(L({ PropertySubType: "Condo" })), ctx(L({ PropertySubType: "Detached" }))]);
    expect(r.displayed).toEqual(["Condo", "Detached"]);
    expect(r.winners.size).toBe(0);
  });

  it("reads recomputed cap rate from the underwriting context and tags it 'est'", () => {
    const c1: MetricContext = { listing: L({}), isAuthed: true, underwriting: { capRatePct: 4.2 } as never };
    const c2: MetricContext = { listing: L({}), isAuthed: true, underwriting: { capRatePct: 5.1 } as never };
    const r = resolveRow(metric("capRateUw"), [c1, c2]);
    expect(r.displayed).toEqual(["4.2%", "5.1%"]);
    expect([...r.winners]).toEqual([1]);
    expect(r.tags).toEqual(["est", "est"]);
  });

  it("does not crown a winner when no property has a price drop", () => {
    const flat = L({ OriginalListPrice: 100, ListPrice: 100 });
    const r = resolveRow(metric("priceDrop"), [ctx(flat), ctx(flat)]);
    expect(r.winners.size).toBe(0);
    expect(r.displayed).toEqual([null, null]);
  });
});

describe("core vs extended split", () => {
  it("CORE_METRICS holds the 17 classic rows in order", () => {
    expect(CORE_METRICS.map((m) => m.key)).toEqual([
      "dealScore", "estValue", "vsEstimate", "listPrice", "ppsf",
      "beds", "baths", "parking", "trueDom", "priceDrop",
      "capRateUw", "carry", "taxes", "fees", "type", "suite", "brokerage",
    ]);
  });

  it("extendedGroupMetrics returns only the non-core rows per group", () => {
    expect(extendedGroupMetrics("cashflowCarry").map((m) => m.key)).toEqual(["capRateVA", "cashflow"]);
    expect(extendedGroupMetrics("distressTiming").map((m) => m.key)).toEqual(["stale"]);
    expect(extendedGroupMetrics("suiteDensity").map((m) => m.key)).toEqual([
      "suiteScore", "multiUnit", "surplusParking", "densityReady",
    ]);
    expect(extendedGroupMetrics("valuationDeal")).toEqual([]);
    expect(extendedGroupMetrics("structural")).toEqual([]);
  });

  it("core + extended partition every metric exactly once", () => {
    const groups = ["valuationDeal", "cashflowCarry", "distressTiming", "suiteDensity", "structural"] as const;
    const all = [...CORE_METRICS, ...groups.flatMap((g) => extendedGroupMetrics(g))].map((m) => m.key);
    expect(all.slice().sort()).toEqual(COMPARE_METRICS.map((m) => m.key).sort());
    expect(new Set(all).size).toBe(COMPARE_METRICS.length);
  });
});

describe("visibleRows", () => {
  it("drops identical rows in diff mode but keeps alwaysShow (brokerage)", () => {
    const same = [ctx(L({ ListOfficeName: "ACME", BedroomsTotal: 3 })), ctx(L({ ListOfficeName: "ACME", BedroomsTotal: 3 }))];
    const keys = visibleRows(CORE_METRICS, same, true).map((r) => r.metric.key);
    expect(keys).toContain("brokerage"); // alwaysShow survives even when identical
    expect(keys).not.toContain("beds"); // identical → hidden in diff mode
  });

  it("keeps all rows when diff mode is off", () => {
    const same = [ctx(L({ BedroomsTotal: 3 })), ctx(L({ BedroomsTotal: 3 }))];
    expect(visibleRows(CORE_METRICS, same, false).length).toBe(CORE_METRICS.length);
  });
});

describe("lensGroupOrder", () => {
  it("floats the persona's priority group to the front", () => {
    expect(lensGroupOrder("cashflow")[0]).toBe("cashflowCarry");
    expect(lensGroupOrder("smart")[0]).toBe("valuationDeal");
    expect(lensGroupOrder("builders")[0]).toBe("suiteDensity");
  });
  it("keeps all five groups exactly once", () => {
    const order = lensGroupOrder("flippers");
    expect(new Set(order).size).toBe(5);
    expect(order[0]).toBe("distressTiming");
  });
});
