import { describe, it, expect } from "vitest";
import { statusBadge } from "./statusBadge";

describe("statusBadge", () => {
  it("returns null for plain-active statuses (no badge needed)", () => {
    for (const s of ["New", "Price Change", "Extension", "Active", "", undefined]) {
      expect(statusBadge(s)).toBeNull();
    }
  });

  it("flags conditionally-sold listings (amber)", () => {
    expect(statusBadge("Sold Conditional")).toEqual({ label: "Sold Cond.", tone: "warn" });
    expect(statusBadge("Sold Conditional Escape")).toEqual({ label: "Sold Cond.", tone: "warn" });
  });

  it("flags conditionally-leased listings (amber)", () => {
    expect(statusBadge("Leased Conditional")).toEqual({ label: "Leased Cond.", tone: "warn" });
    expect(statusBadge("Leased Conditional Escape")).toEqual({ label: "Leased Cond.", tone: "warn" });
  });

  it("flags back-on-market listings (info)", () => {
    expect(statusBadge("Deal Fell Through")).toEqual({ label: "Back on Market", tone: "info" });
  });

  it("passes through any other non-active status verbatim (neutral)", () => {
    expect(statusBadge("Suspended")).toEqual({ label: "Suspended", tone: "neutral" });
  });

  it("is case/space tolerant", () => {
    expect(statusBadge("  sold conditional  ")).toEqual({ label: "Sold Cond.", tone: "warn" });
  });
});
