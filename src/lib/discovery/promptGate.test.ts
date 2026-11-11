import { describe, expect, it } from "vitest";
import { mayShowCard, mayShowNewBadge, parsePageViews, slotTakenBy, type GateInput } from "./promptGate";

const base: GateInput = { card: "tour", pageViews: 2, signedIn: false, surface: "terminal", slotTaken: false };

describe("mayShowCard", () => {
  it("shows no card on the first page view, signed in or not", () => {
    expect(mayShowCard({ ...base, pageViews: 1 })).toBe(false);
    expect(mayShowCard({ ...base, pageViews: 1, signedIn: true })).toBe(false);
    expect(mayShowCard({ ...base, card: "install", pageViews: 1, signedIn: true })).toBe(false);
  });

  it("shows the tour card from the second page view", () => {
    expect(mayShowCard(base)).toBe(true);
  });

  it("shows one card per page view", () => {
    expect(mayShowCard({ ...base, slotTaken: true })).toBe(false);
    expect(mayShowCard({ ...base, card: "install", signedIn: true, slotTaken: true })).toBe(false);
  });

  it("keeps the install card for signed-in visitors", () => {
    expect(mayShowCard({ ...base, card: "install", surface: "listing" })).toBe(false);
    expect(mayShowCard({ ...base, card: "install", surface: "listing", signedIn: true })).toBe(true);
  });

  it("keeps the tour card off a page that is locked for a signed-out visitor", () => {
    expect(mayShowCard({ ...base, surface: "dashboard" })).toBe(false);
    expect(mayShowCard({ ...base, surface: "dashboard", signedIn: true })).toBe(true);
  });
});

describe("mayShowNewBadge", () => {
  it("shows the what's-new count to signed-in visitors only", () => {
    expect(mayShowNewBadge(false)).toBe(false);
    expect(mayShowNewBadge(true)).toBe(true);
  });
});

describe("slotTakenBy", () => {
  it("blocks the other card on the same page view, never the card that holds the slot", () => {
    const s = { slotPath: "/properties/X1", slotCard: "tour" as const };
    expect(slotTakenBy(s, "/properties/X1", "install")).toBe(true);
    expect(slotTakenBy(s, "/properties/X1", "tour")).toBe(false);
    expect(slotTakenBy(s, "/dashboard", "install")).toBe(false);
    expect(slotTakenBy({ slotPath: null, slotCard: null }, "/dashboard", "install")).toBe(false);
  });
});

describe("parsePageViews", () => {
  it("reads a stored count and rejects junk", () => {
    expect(parsePageViews(null)).toBe(0);
    expect(parsePageViews("7")).toBe(7);
    expect(parsePageViews("-3")).toBe(0);
    expect(parsePageViews("abc")).toBe(0);
  });
});
