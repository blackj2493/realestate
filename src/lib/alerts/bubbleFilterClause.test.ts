import { describe, it, expect } from "vitest";
import { bubbleAlertFilter } from "./bubbleFilterClause";
import { defaultTerminalFilters } from "@/lib/personas/personaConfig";

const BASE_SNAPSHOT = {
  activePersona: "smart",
  filters: defaultTerminalFilters,
  location: "Nepean",
  commute: { enabled: false, destination: null, mode: "driving", minutes: 30 },
  school: { targetSchool: null },
};

describe("bubbleAlertFilter", () => {
  it("pre-095 snapshot (no universalFilters) → nulls, worker falls back to 'all'", () => {
    expect(bubbleAlertFilter(BASE_SNAPSHOT)).toEqual({ clause: null, label: null });
    expect(bubbleAlertFilter(null)).toEqual({ clause: null, label: null });
    expect(bubbleAlertFilter("garbage")).toEqual({ clause: null, label: null });
  });

  it("beds + type filters → terminal clauses and a readable label", () => {
    const out = bubbleAlertFilter({
      ...BASE_SNAPSHOT,
      transactionMode: "sale",
      propertyClass: "residential",
      universalFilters: {
        beds: { n: 3, exact: false },
        homeType: ["Detached"],
      },
    });
    expect(out.clause).toBeTruthy();
    // Terminal semantics, not a re-implementation: transaction + beds + type present.
    expect(out.clause).toContain("TransactionType");
    expect(out.clause!.toLowerCase()).toContain("bedroom");
    expect(out.clause).toContain("Detached");
    expect(out.label).toBeTruthy();
    expect(out.label).toContain("Detached");
    expect(out.label).toMatch(/3\+/);
  });

  it("price band appears in both clause and label", () => {
    const out = bubbleAlertFilter({
      ...BASE_SNAPSHOT,
      transactionMode: "sale",
      propertyClass: "residential",
      universalFilters: { price: [500_000, 900_000] },
    });
    expect(out.clause).toContain("ListPrice");
    expect(out.clause).toContain("900000");
    expect(out.label).toBeTruthy();
  });

  it("all-default universal filters → clause exists but label is null (matches ~'all')", () => {
    const out = bubbleAlertFilter({
      ...BASE_SNAPSHOT,
      transactionMode: "sale",
      propertyClass: "residential",
      universalFilters: {},
    });
    expect(out.clause).toBeTruthy();
    expect(out.label).toBeNull();
  });

  it("unknown/renamed filter keys and malformed values degrade instead of throwing", () => {
    const out = bubbleAlertFilter({
      ...BASE_SNAPSHOT,
      transactionMode: "sale",
      propertyClass: "residential",
      universalFilters: {
        beds: { n: 2, exact: true },
        someRemovedFilter: [1, 2],
        homeType: 42, // wrong shape
      },
    });
    expect(out.clause).toBeTruthy();
    expect(out.label).toContain("2");
  });

  it("city lens variant: dashboard-lens semantics + readable label", () => {
    const out = bubbleAlertFilter({
      lens: {
        windowDays: 7,
        transactionType: "sale",
        propertyTypes: ["detached", "town"],
        minBeds: 3,
        bedsExact: false,
        minBaths: 0,
        bathsExact: false,
        minGarage: 2,
        garageExact: false,
        basement: "finished",
        minFrontage: 0,
      },
    });
    expect(out.clause).toBeTruthy();
    expect(out.clause).toContain("ListPrice:>=100000");
    expect(out.clause).toContain("PropertySubType"); // type expansion via the dashboard builder
    expect(out.clause).toContain("ParkingTotal:>=2");
    expect(out.label).toContain("Detached/Townhouse");
    expect(out.label).toContain("3+ bd");
    expect(out.label).toContain("finished bsmt");
  });

  it("city lens with junk fields degrades to defaults, never throws", () => {
    const out = bubbleAlertFilter({ lens: { windowDays: "x", propertyTypes: 42 } });
    expect(out.clause).toBeTruthy(); // floor + transaction at minimum
    expect(out.label).toBeNull(); // nothing active → area-wide (≈ 'all')
  });

  it("rent-mode snapshot labels itself and uses rent price bounds", () => {
    const out = bubbleAlertFilter({
      ...BASE_SNAPSHOT,
      transactionMode: "rent",
      propertyClass: "residential",
      universalFilters: {},
    });
    expect(out.clause).toContain("For Lease");
    // label only says For Rent when something else is active? No — mode is worth
    // flagging on its own; the section header otherwise implies sales.
    expect(out.label).toContain("For Rent");
  });
});
