import { describe, it, expect } from "vitest";
import { hasActiveAlertFilters } from "./hasActiveAlertFilters";

/** The exact snapshot a school bubble stored on 2026-09-23 — complete, valid, and
 *  narrowing nothing. `alert_scope` read 'filtered' and the email carried townhouses. */
const DEFAULTS_ONLY = {
  school: {}, commute: {}, filters: {}, location: {},
  activePersona: "explorer", propertyClass: "residential", transactionMode: "sale",
  universalFilters: {
    age: [], beds: 0, sqft: { hi: 999999, lo: 0, loose: true, unsized: false },
    baths: 0, faces: [], price: [0, 3000000], suite: [], garage: 0,
    lotSize: [0, 20000], parking: 0, basement: [], homeType: [], kitchens: 0,
    maintFee: [0, 2000], multiUnit: [], occupancy: [], lotFrontage: [0, 200],
  },
};

const LENS = {
  minBeds: 0, bedsExact: false, minBaths: 0, bathsExact: false, minGarage: 0,
  garageExact: false, minFrontage: 0, basement: "any", propertyTypes: [],
  transactionType: "sale", windowDays: 90,
};

describe("hasActiveAlertFilters", () => {
  it("is FALSE for a terminal snapshot whose every field is a default", () => {
    // The whole point. `"universalFilters" in filters` was true here, which is why the
    // old gate let "My filters only" be selected on a rule that excludes nothing.
    expect(hasActiveAlertFilters(DEFAULTS_ONLY)).toBe(false);
  });

  it("is TRUE once a single filter is narrowed", () => {
    const beds = { ...DEFAULTS_ONLY, universalFilters: { ...DEFAULTS_ONLY.universalFilters, beds: 4 } };
    expect(hasActiveAlertFilters(beds)).toBe(true);
    const type = { ...DEFAULTS_ONLY, universalFilters: { ...DEFAULTS_ONLY.universalFilters, homeType: ["detached"] } };
    expect(hasActiveAlertFilters(type)).toBe(true);
  });

  it("reads the lens shape too, and agrees with hasActiveLensFilters", () => {
    expect(hasActiveAlertFilters({ lens: LENS })).toBe(false);
    expect(hasActiveAlertFilters({ lens: { ...LENS, minBeds: 4 } })).toBe(true);
    expect(hasActiveAlertFilters({ lens: { ...LENS, propertyTypes: ["detached"] } })).toBe(true);
  });

  it("is FALSE for a missing or malformed snapshot rather than throwing", () => {
    // `filters: NULL` is the scope='all' shape; a throw here would break the dashboard.
    expect(hasActiveAlertFilters(null)).toBe(false);
    expect(hasActiveAlertFilters(undefined)).toBe(false);
    expect(hasActiveAlertFilters("nonsense")).toBe(false);
    expect(hasActiveAlertFilters({})).toBe(false);
    expect(hasActiveAlertFilters({ universalFilters: { beds: "four" } })).toBe(false);
    expect(hasActiveAlertFilters({ lens: { minBeds: "x" } })).toBe(false);
  });

  it("ignores a filter key that no longer exists", () => {
    // The clause builder skips unknown keys, so this must not report narrowing the
    // query will not actually perform.
    expect(hasActiveAlertFilters({ universalFilters: { someRemovedFilter: 99 } })).toBe(false);
  });
});
