import { describe, it, expect } from "vitest";
import { columnSortValue } from "./columnSort";
import type { ListingDocument } from "@/lib/typesense/client";

const doc = (over: Partial<ListingDocument> = {}): ListingDocument => ({ ...over } as ListingDocument);

describe("columnSortValue cap/yield", () => {
  it("uses the real cap_rate_est, band-guarded", () => {
    expect(columnSortValue(doc({ cap_rate_est: 6.2 }), "capRate")).toBe(6.2);
    expect(columnSortValue(doc({ cap_rate_est: 99 }), "capRate")).toBeNull();
    expect(columnSortValue(doc({}), "capRate")).toBeNull();
  });
  it("uses the real gross_yield_est (percent), band-guarded — NOT the fraction", () => {
    expect(columnSortValue(doc({ gross_yield_est: 5.1 }), "yield")).toBe(5.1);
    expect(columnSortValue(doc({ gross_yield_est: 99 }), "yield")).toBeNull();
  });
  it("ignores the fake ExtrapolatedCapRate", () => {
    expect(columnSortValue(doc({ ExtrapolatedCapRate: 8 } as Partial<ListingDocument>), "capRate")).toBeNull();
  });
});
