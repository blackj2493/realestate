import { describe, it, expect } from "vitest";
import { deriveDealType } from "./dealType";

describe("deriveDealType", () => {
  it("uses MlsStatus first: 'Leased' → leased", () => {
    expect(deriveDealType("Leased", "For Sale")).toBe("leased");
  });
  it("'Sold' / 'Closed Sale' → sold", () => {
    expect(deriveDealType("Sold", null)).toBe("sold");
    expect(deriveDealType("Closed Sale", null)).toBe("sold");
  });
  it("falls back to TransactionType when MlsStatus is unhelpful", () => {
    expect(deriveDealType("Closed", "For Lease")).toBe("leased");
    expect(deriveDealType("Closed", "For Sale")).toBe("sold");
  });
  it("defaults to sold when neither signal is present (price is NEVER used)", () => {
    expect(deriveDealType(null, null)).toBe("sold");
    expect(deriveDealType("", "")).toBe("sold");
  });
  it("is case/space tolerant", () => {
    expect(deriveDealType("  leased  ", null)).toBe("leased");
    expect(deriveDealType(null, "for lease")).toBe("leased");
  });
});
