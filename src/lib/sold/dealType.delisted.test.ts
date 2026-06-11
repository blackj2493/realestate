import { describe, it, expect } from "vitest";
import {
  deriveDelistedDealType,
  isDelistedDealType,
  type DelistedDealType,
} from "./dealType";

describe("deriveDelistedDealType", () => {
  it("maps MlsStatus to the specific de-list reason", () => {
    expect(deriveDelistedDealType("Terminated")).toBe("terminated");
    expect(deriveDelistedDealType("Expired")).toBe("expired");
    expect(deriveDelistedDealType("Suspended")).toBe("suspended");
  });

  it("is case/whitespace tolerant", () => {
    expect(deriveDelistedDealType("  TERMINATED ")).toBe("terminated");
  });

  it("returns null for sold/leased/active/unknown statuses", () => {
    expect(deriveDelistedDealType("Sold")).toBeNull();
    expect(deriveDelistedDealType("Leased")).toBeNull();
    expect(deriveDelistedDealType("New")).toBeNull();
    expect(deriveDelistedDealType(null)).toBeNull();
    expect(deriveDelistedDealType(undefined)).toBeNull();
  });
});

describe("isDelistedDealType", () => {
  it("recognizes exactly the three de-list reasons", () => {
    const yes: DelistedDealType[] = ["terminated", "expired", "suspended"];
    for (const v of yes) expect(isDelistedDealType(v)).toBe(true);
    expect(isDelistedDealType("sold")).toBe(false);
    expect(isDelistedDealType("leased")).toBe(false);
    expect(isDelistedDealType(undefined)).toBe(false);
  });
});
