import { describe, it, expect } from "vitest";
import { mergeLayers } from "./mergeLayers";
import type { ListingDocument } from "@/lib/typesense/client";
const d = (id: string, t?: number): ListingDocument => ({ id, ListPrice: 1, location: [0,0], isDistressed: false, hasSecondarySuitePotential: false, EntryTimestamp: t });
describe("mergeLayers", () => {
  it("concatenates, de-dupes by id (first wins), sorts by recency desc", () => {
    const out = mergeLayers([[d("a", 100), d("b", 300)], [d("b", 999), d("c", 200)]]);
    expect(out.map((x) => x.id)).toEqual(["b", "c", "a"]);
  });
});
