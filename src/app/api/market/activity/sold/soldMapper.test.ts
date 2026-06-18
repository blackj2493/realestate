import { describe, it, expect } from "vitest";
import { mapSoldDoc } from "./soldMapper";

describe("mapSoldDoc", () => {
  it("maps a sold doc and splits the geopoint into lat/lng", () => {
    const out = mapSoldDoc({
      id: "W123",
      UnparsedAddress: "1 King St, Toronto, ON",
      ClosePrice: 950000,
      ListPrice: 999000,
      PurchaseContractDate: 1_716_000_000_000,
      PropertySubType: "Detached",
      BedroomsTotal: 3,
      BedroomsAboveGrade: 2,
      BedroomsBelowGrade: 1,
      BathroomsTotalInteger: 2,
      BuildingAreaTotal: 1500,
      ListOfficeName: "ACME REALTY",
      City: "Toronto",
      primaryImageUrl: "https://img/x.jpg",
      location: [43.65, -79.38],
    });
    expect(out.id).toBe("W123");
    expect(out.closePrice).toBe(950000);
    expect(out.listPrice).toBe(999000);
    expect(out.beds).toBe(3);
    expect(out.bedsAbove).toBe(2);
    expect(out.bedsBelow).toBe(1);
    expect(out.lat).toBe(43.65);
    expect(out.lng).toBe(-79.38);
    expect(out.soldDate).toBe(new Date(1_716_000_000_000).toISOString());
  });

  it("yields null coords when the geopoint is absent", () => {
    const out = mapSoldDoc({ id: "X1", ClosePrice: 500000, PurchaseContractDate: 0 });
    expect(out.lat).toBeNull();
    expect(out.lng).toBeNull();
    expect(out.soldDate).toBeNull();
  });

  it("carries DealType through (defaults to sold)", () => {
    expect(mapSoldDoc({ id: "X1", DealType: "leased", PurchaseContractDate: 1 }).dealType).toBe("leased");
    expect(mapSoldDoc({ id: "X2", PurchaseContractDate: 1 }).dealType).toBe("sold");
  });
});
