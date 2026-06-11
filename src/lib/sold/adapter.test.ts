import { describe, it, expect } from "vitest";
import { soldToListingDocument } from "./adapter";
import type { SoldListing } from "@/app/api/market/activity/sold/soldMapper";

const base: SoldListing = {
  id: "W123",
  address: "1 King St, Toronto, ON",
  closePrice: 950000,
  listPrice: 999000,
  soldDate: "2026-05-20T00:00:00.000Z",
  propertySubType: "Detached",
  beds: 3,
  baths: 2,
  sqft: 1500,
  brokerage: "ACME REALTY",
  city: "Toronto",
  primaryImageUrl: "https://img/x.jpg",
  lat: 43.65,
  lng: -79.38,
  dealType: "sold",
  daysOnMarket: null,
  originalListPrice: null,
};

describe("soldToListingDocument", () => {
  it("maps close price to ListPrice (pin/card price) and ask to OriginalListPrice", () => {
    const d = soldToListingDocument(base);
    expect(d.ListPrice).toBe(950000);
    expect(d.OriginalListPrice).toBe(999000);
  });

  it("flags the doc as a sold comp and carries the sold date", () => {
    const d = soldToListingDocument(base);
    expect(d.IsSoldComp).toBe(true);
    expect(d.SoldDate).toBe("2026-05-20T00:00:00.000Z");
  });

  it("uses [lat, lng] for location when coords exist", () => {
    expect(soldToListingDocument(base).location).toEqual([43.65, -79.38]);
  });

  it("falls back to [0, 0] when coords are missing (filtered out by the map)", () => {
    const d = soldToListingDocument({ ...base, lat: null, lng: null });
    expect(d.location).toEqual([0, 0]);
  });

  it("carries brokerage + thumbnail for the card", () => {
    const d = soldToListingDocument(base);
    expect(d.ListOfficeName).toBe("ACME REALTY");
    expect(d.primaryImageUrl).toBe("https://img/x.jpg");
    expect(d.thumbnailUrl).toBe("https://img/x.jpg");
  });

  it("sets compKind + LeasedDate for leased comps", () => {
    const leased: SoldListing = {
      id: "L1",
      dealType: "leased",
      soldDate: "2026-05-01T00:00:00Z",
      closePrice: 3200,
      listPrice: 3300,
      address: "1 King St",
      lat: 43.6,
      lng: -79.4,
      propertySubType: null,
      beds: null,
      baths: null,
      sqft: null,
      brokerage: null,
      city: null,
      primaryImageUrl: null,
      daysOnMarket: null,
      originalListPrice: null,
    };
    const doc = soldToListingDocument(leased);
    expect(doc.compKind).toBe("leased");
    expect(doc.LeasedDate).toBe("2026-05-01T00:00:00Z");
    expect(doc.ListPrice).toBe(3200);
  });
});
