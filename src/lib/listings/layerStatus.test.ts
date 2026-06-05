import { describe, it, expect } from "vitest";
import { layerStatus } from "./layerStatus";
import type { ListingDocument } from "@/lib/typesense/client";
const doc = (p: Partial<ListingDocument>): ListingDocument => ({ id: "x", ListPrice: 1, location: [0,0], isDistressed: false, hasSecondarySuitePotential: false, ...p });
describe("layerStatus", () => {
  it("comp kinds win", () => {
    expect(layerStatus(doc({ compKind: "sold" })).label).toBe("SOLD");
    expect(layerStatus(doc({ compKind: "leased" })).label).toBe("LEASED");
  });
  it("active uses TransactionType", () => {
    expect(layerStatus(doc({ TransactionType: "For Lease" })).label).toBe("FOR RENT");
    expect(layerStatus(doc({ TransactionType: "For Sale" })).label).toBe("FOR SALE");
  });
});
