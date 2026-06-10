import { describe, it, expect } from "vitest";
import { toggleLayer, queryPlan, type LayerKey } from "./layers";
import { clampWindowDays, DELISTED_DISPLAY_MAX_DAYS } from "./config";
import { soldToListingDocument } from "./adapter";
import type { SoldListing } from "@/app/api/market/activity/sold/soldMapper";

describe("delisted layer", () => {
  it("is toggleable and independent of forSale/forRent exclusivity", () => {
    const layers = toggleLayer(new Set<LayerKey>(["forSale"]), "delisted");
    expect(layers.has("delisted")).toBe(true);
    expect(layers.has("forSale")).toBe(true);
  });

  it("queryPlan emits a 'delisted' comp kind", () => {
    const plan = queryPlan(new Set<LayerKey>(["delisted"]));
    expect(plan.comps).toEqual(["delisted"]);
    expect(plan.active).toBeNull();
  });

  it("toggleLayer on an already-active delisted layer refuses to empty the set", () => {
    expect(toggleLayer(new Set<LayerKey>(["delisted"]), "delisted").has("delisted")).toBe(true); // refuses to empty
  });
});

describe("per-kind window clamp", () => {
  it("delisted clamps to 90, sold keeps 180", () => {
    expect(DELISTED_DISPLAY_MAX_DAYS).toBe(90);
    expect(clampWindowDays(180, "delisted")).toBe(90);
    expect(clampWindowDays(180, "sold")).toBe(180);
    expect(clampWindowDays(30, "delisted")).toBe(30);
  });
});

describe("adapter — delisted comp", () => {
  const s: SoldListing = {
    id: "X1",
    address: "19 Hossie Terrace",
    closePrice: 0,
    listPrice: 899000,
    soldDate: "2026-05-22T00:00:00.000Z",
    propertySubType: "Detached",
    beds: 3,
    baths: 2.5,
    sqft: null,
    brokerage: "Acme Realty",
    city: "Stratford",
    primaryImageUrl: null,
    lat: 43.37,
    lng: -80.98,
    dealType: "terminated",
    daysOnMarket: 47,
    originalListPrice: 949000,
  };

  it("carries last ask as ListPrice, original ask, reason compKind, DelistedDate, DaysOnMarket", () => {
    const doc = soldToListingDocument(s);
    expect(doc.compKind).toBe("terminated");
    expect(doc.ListPrice).toBe(899000);
    expect(doc.OriginalListPrice).toBe(949000);
    expect(doc.DelistedDate).toBe("2026-05-22T00:00:00.000Z");
    expect(doc.DaysOnMarket).toBe(47);
    expect(doc.SoldDate).toBeUndefined();
    expect(doc.LeasedDate).toBeUndefined();
    expect(doc.IsSoldComp).toBe(true);
  });
});
