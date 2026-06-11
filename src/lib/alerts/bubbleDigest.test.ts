import { describe, expect, it } from "vitest";
import {
  buildBubbleSections,
  BUBBLE_EMAIL_ROW_CAP,
  BUBBLE_COLLAPSE_THRESHOLD,
  type BubbleMatches,
  type NewListingAlert,
} from "./bubbleDigest";

function listing(key: string, entryMs = 0): NewListingAlert {
  return {
    listing_key: key,
    address: `${key} Test St`,
    city: "Brampton",
    price: 800_000,
    beds: 3,
    baths: 2,
    brokerage: "TEST BROKERAGE",
    entryMs,
  };
}

function bubble(id: string, name: string, matches: NewListingAlert[], total = matches.length): BubbleMatches {
  return { bubbleId: id, bubbleName: name, total, matches };
}

describe("buildBubbleSections", () => {
  it("passes small result sets through untouched, newest first", () => {
    const sections = buildBubbleSections([
      bubble("b1", "Pocket A", [listing("W1", 1), listing("W2", 3), listing("W3", 2)]),
    ]);
    expect(sections).toHaveLength(1);
    expect(sections[0].collapsed).toBe(false);
    expect(sections[0].listings.map((l) => l.listing_key)).toEqual(["W2", "W3", "W1"]);
    expect(sections[0].total).toBe(3);
  });

  it("caps rows at BUBBLE_EMAIL_ROW_CAP, keeping the true total", () => {
    const many = Array.from({ length: 10 }, (_, i) => listing(`W${i}`, i));
    const [s] = buildBubbleSections([bubble("b1", "Pocket A", many)]);
    expect(s.listings).toHaveLength(BUBBLE_EMAIL_ROW_CAP);
    expect(s.total).toBe(10);
    expect(s.collapsed).toBe(false);
  });

  it("collapses chronically noisy bubbles to a count-only section", () => {
    const many = Array.from({ length: BUBBLE_COLLAPSE_THRESHOLD + 1 }, (_, i) => listing(`W${i}`, i));
    const [s] = buildBubbleSections([bubble("b1", "Half of Brampton", many, many.length)]);
    expect(s.collapsed).toBe(true);
    expect(s.listings).toHaveLength(0);
    expect(s.total).toBe(BUBBLE_COLLAPSE_THRESHOLD + 1);
  });

  it("de-dups a listing appearing in two bubbles — first bubble wins", () => {
    const shared = listing("W9", 5);
    const sections = buildBubbleSections([
      bubble("b1", "Pocket A", [shared, listing("W1", 1)]),
      bubble("b2", "Pocket B", [shared, listing("W2", 2)]),
    ]);
    expect(sections[0].listings.map((l) => l.listing_key)).toContain("W9");
    expect(sections[1].listings.map((l) => l.listing_key)).not.toContain("W9");
    expect(sections[1].total).toBe(1); // de-dup adjusts the displayed total
  });

  it("drops bubbles that end up empty after de-dup", () => {
    const shared = listing("W9");
    const sections = buildBubbleSections([
      bubble("b1", "Pocket A", [shared]),
      bubble("b2", "Pocket B", [shared]),
    ]);
    expect(sections).toHaveLength(1);
  });
});
