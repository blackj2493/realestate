import { describe, expect, it } from "vitest";
import {
  advanceNotifiedKeys,
  buildBubbleSections,
  compareBubbleSpecificity,
  filterFreshMatches,
  parseNotifiedKeys,
  BUBBLE_EMAIL_ROW_CAP,
  BUBBLE_COLLAPSE_THRESHOLD,
  NOTIFIED_KEY_RETENTION_MS,
  type BubbleAreaOrder,
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
    expect(sections[0].highVolume).toBe(false);
    expect(sections[0].listings.map((l) => l.listing_key)).toEqual(["W2", "W3", "W1"]);
    expect(sections[0].total).toBe(3);
  });

  it("caps rows at BUBBLE_EMAIL_ROW_CAP, keeping the true total", () => {
    const many = Array.from({ length: 10 }, (_, i) => listing(`W${i}`, i));
    const [s] = buildBubbleSections([bubble("b1", "Pocket A", many)]);
    expect(s.listings).toHaveLength(BUBBLE_EMAIL_ROW_CAP);
    expect(s.total).toBe(10);
    expect(s.highVolume).toBe(false);
  });

  it("flags a noisy bubble as high volume but STILL sends rows", () => {
    // The regression this guards: a busy area used to render as a bare count and no homes.
    // Toronto/Mississauga/Brampton all clear this threshold every night, so that was the
    // normal nightly email for anyone tracking a city — and the reason they unsubscribed.
    const many = Array.from({ length: BUBBLE_COLLAPSE_THRESHOLD + 1 }, (_, i) => listing(`W${i}`, i));
    const [s] = buildBubbleSections([bubble("b1", "Half of Brampton", many, many.length)]);
    expect(s.highVolume).toBe(true);
    expect(s.listings).toHaveLength(BUBBLE_EMAIL_ROW_CAP);
    expect(s.total).toBe(BUBBLE_COLLAPSE_THRESHOLD + 1);
  });

  it("carries filterLabel through, and leaves it null when the area alerts on everything", () => {
    const [labelled, bare] = buildBubbleSections([
      { ...bubble("b1", "Filtered Area", [listing("W1", 1)]), filterLabel: "3+ bd · Detached" },
      bubble("b2", "Open Area", [listing("W2", 2)]),
    ]);
    expect(labelled.filterLabel).toBe("3+ bd · Detached");
    // null (not undefined) is what the digest tests to decide who needs the filter nudge.
    expect(bare.filterLabel).toBeNull();
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

describe("lookback dedup helpers (notified_keys)", () => {
  const NOW = 1_752_900_000_000;

  it("parseNotifiedKeys tolerates garbage shapes", () => {
    expect(parseNotifiedKeys(null)).toEqual([]);
    expect(parseNotifiedKeys("nope")).toEqual([]);
    expect(parseNotifiedKeys([{ k: "N1", t: 5 }, { bad: true }, 7])).toEqual([{ k: "N1", t: 5 }]);
  });

  it("filterFreshMatches drops already-alerted keys", () => {
    const matches = [listing("N1"), listing("N2")];
    expect(filterFreshMatches(matches, [{ k: "N1", t: NOW }]).map((m) => m.listing_key)).toEqual(["N2"]);
  });

  it("advanceNotifiedKeys appends fresh keys and prunes beyond retention", () => {
    const old = { k: "OLD", t: NOW - NOTIFIED_KEY_RETENTION_MS - 1 };
    const kept = { k: "KEPT", t: NOW - 1000 };
    const next = advanceNotifiedKeys([old, kept], ["N1", "KEPT"], NOW);
    expect(next.map((n) => n.k).sort()).toEqual(["KEPT", "N1"]);
    expect(next.find((n) => n.k === "N1")?.t).toBe(NOW);
    // an existing key is not re-stamped (its original alert time stands)
    expect(next.find((n) => n.k === "KEPT")?.t).toBe(NOW - 1000);
  });
});

describe("compareBubbleSpecificity — narrowest area claims a listing first", () => {
  const area = (
    id: string,
    area_type: string,
    city: string | null,
    created_at = "2026-01-01T00:00:00Z"
  ): BubbleAreaOrder => ({
    id,
    name: city ?? id,
    area_type,
    source: city ? { city } : null,
    created_at,
  });

  const order = (rows: BubbleAreaOrder[]) =>
    [...rows].sort(compareBubbleSpecificity).map((r) => r.id);

  it("puts a drawn / school area ahead of every city row", () => {
    expect(
      order([
        area("city", "city", "Toronto"),
        area("community", "city", "Vellore Village"),
        area("school", "school", null),
        area("drawn", "draw", null),
      ])
    ).toEqual(["drawn", "school", "community", "city"]);
  });

  it("puts a community ahead of the whole city that contains it", () => {
    // The live case: every Half Moon Bay listing is also a Barrhaven listing, so whichever
    // ran first took all of them and the other section rendered nothing.
    expect(
      order([area("toronto", "city", "Toronto"), area("district", "city", "Toronto C01")])
    ).toEqual(["district", "toronto"]);
  });

  it("is a TOTAL order — equal rank falls back to created_at, then id", () => {
    const older = area("z-older", "city", "Milton", "2026-01-01T00:00:00Z");
    const newer = area("a-newer", "city", "Ajax", "2026-06-01T00:00:00Z");
    expect(order([newer, older])).toEqual(["z-older", "a-newer"]);

    const sameDay = [
      area("b", "city", "Ajax", "2026-01-01T00:00:00Z"),
      area("a", "city", "Milton", "2026-01-01T00:00:00Z"),
    ];
    expect(order(sameDay)).toEqual(["a", "b"]);
    expect(order([...sameDay].reverse())).toEqual(["a", "b"]);
  });

  it("falls back to the row name when source.city is missing", () => {
    expect(
      order([area("named-city", "city", null), { id: "x", name: "Toronto", area_type: "city" }])
    ).toEqual(["named-city", "x"]);
  });
});
