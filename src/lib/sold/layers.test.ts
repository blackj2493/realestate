import { describe, it, expect } from "vitest";
import { LAYER_KEYS, toggleLayer, transactionModeForLayers, queryPlan, deriveLegacyListingMode } from "./layers";

describe("layers", () => {
  it("toggle adds/removes but never empties (last layer sticks)", () => {
    expect([...toggleLayer(new Set(["forSale"]), "sold")]).toEqual(["forSale", "sold"]);
    expect([...toggleLayer(new Set(["forSale", "sold"]), "sold")]).toEqual(["forSale"]);
    expect([...toggleLayer(new Set(["sold"]), "sold")]).toEqual(["sold"]); // can't empty
  });
  it("transactionMode: sale wins, else rent, else sale", () => {
    expect(transactionModeForLayers(new Set(["forRent"]))).toBe("rent");
    expect(transactionModeForLayers(new Set(["forSale", "forRent"]))).toBe("sale");
    expect(transactionModeForLayers(new Set(["sold"]))).toBe("sale");
  });
  it("queryPlan splits active vs comp sources", () => {
    const p = queryPlan(new Set(["forSale", "sold", "leased"]));
    expect(p.active).toEqual({ enabled: true, sale: true, rent: false });
    expect(p.comps).toEqual(["sold", "leased"]);
  });
  it("comp-only plan disables the active source", () => {
    expect(queryPlan(new Set(["sold"])).active).toBeNull();
  });
  it("legacy listingMode: sale/rent win, comp-only → sold", () => {
    expect(deriveLegacyListingMode(new Set(["forSale", "sold"]))).toBe("sale");
    expect(deriveLegacyListingMode(new Set(["forRent"]))).toBe("rent");
    expect(deriveLegacyListingMode(new Set(["leased"]))).toBe("sold");
  });
});
