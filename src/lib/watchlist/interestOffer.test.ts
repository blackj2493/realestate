import { describe, expect, it } from "vitest";
import { recordListingVisit, takeInterestOffer, VISIT_GAP_MS } from "./interestOffer";

function memStore() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  };
}

describe("recordListingVisit", () => {
  it("counts a refresh within 30 minutes as the same visit", () => {
    const s = memStore();
    expect(recordListingVisit("W1234567", 0, s)).toBe(1);
    expect(recordListingVisit("W1234567", 5 * 60 * 1000, s)).toBe(1);
    expect(recordListingVisit("w1234567", 5 * 60 * 1000 + VISIT_GAP_MS, s)).toBe(2);
  });
});

describe("takeInterestOffer", () => {
  it("offers nothing on a first, plain visit", () => {
    const s = memStore();
    recordListingVisit("W1", 0, s);
    expect(takeInterestOffer("W1", "", s)).toBeNull();
  });

  it("offers on the second visit, once", () => {
    const s = memStore();
    recordListingVisit("W1", 0, s);
    recordListingVisit("W1", VISIT_GAP_MS, s);
    expect(takeInterestOffer("W1", "", s)).toBe("repeat_view");
    recordListingVisit("W1", 3 * VISIT_GAP_MS, s);
    expect(takeInterestOffer("W1", "", s)).toBeNull();
  });

  it("offers on a first visit that came from one of our emails", () => {
    const s = memStore();
    recordListingVisit("W2", 0, s);
    expect(takeInterestOffer("W2", "?utm_source=watchlist-digest&utm_medium=email&utm_content=listing", s)).toBe(
      "from_email",
    );
  });

  it("does not treat other campaigns as email", () => {
    const s = memStore();
    recordListingVisit("W3", 0, s);
    expect(takeInterestOffer("W3", "?utm_source=reddit&utm_medium=social", s)).toBeNull();
  });

  it("keeps the store bounded", () => {
    const s = memStore();
    for (let i = 0; i < 350; i++) recordListingVisit(`W${i}`, i, s);
    const book = JSON.parse(s.getItem("pp_listing_interest") ?? "{}") as Record<string, unknown>;
    expect(Object.keys(book).length).toBeLessThanOrEqual(300);
    expect(book.W349).toBeTruthy();
    expect(book.W0).toBeUndefined();
  });

  it("never throws without storage", () => {
    expect(recordListingVisit("W1", 0, null)).toBe(0);
    expect(takeInterestOffer("W1", "", null)).toBeNull();
  });
});

describe("takeOpinionOffer", () => {
  it("offers the price opinion on the third visit, once", async () => {
    const { takeOpinionOffer } = await import("./interestOffer");
    const s = memStore();
    recordListingVisit("C9", 0, s);
    recordListingVisit("C9", VISIT_GAP_MS, s);
    expect(takeOpinionOffer("C9", s)).toBe(false);
    recordListingVisit("C9", 2 * VISIT_GAP_MS, s);
    expect(takeOpinionOffer("C9", s)).toBe(true);
    recordListingVisit("C9", 3 * VISIT_GAP_MS, s);
    expect(takeOpinionOffer("C9", s)).toBe(false);
  });

  it("is independent of the save offer", async () => {
    const { takeOpinionOffer } = await import("./interestOffer");
    const s = memStore();
    for (let i = 0; i < 3; i++) recordListingVisit("C8", i * VISIT_GAP_MS, s);
    expect(takeInterestOffer("C8", "", s)).toBe("repeat_view");
    expect(takeOpinionOffer("C8", s)).toBe(true);
  });
});
