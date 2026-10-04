import { describe, it, expect } from "vitest";
import { markSaveOffer, takeSaveOffer, SAVE_OFFER_TTL_MS } from "./saveOffer";

function memStore() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    size: () => m.size,
  };
}

describe("save offer after signup", () => {
  it("offers once for the listing the reader signed up from", () => {
    const s = memStore();
    markSaveOffer("W12632618", 1000, s);
    expect(takeSaveOffer("W12632618", 2000, s)).toBe(true);
    expect(takeSaveOffer("W12632618", 3000, s)).toBe(false);
  });

  it("matches the key regardless of case", () => {
    const s = memStore();
    markSaveOffer("w12632618", 1000, s);
    expect(takeSaveOffer("W12632618", 2000, s)).toBe(true);
  });

  it("leaves the mark in place for a different listing", () => {
    const s = memStore();
    markSaveOffer("W12632618", 1000, s);
    expect(takeSaveOffer("C99999999", 2000, s)).toBe(false);
    expect(takeSaveOffer("W12632618", 3000, s)).toBe(true);
  });

  it("expires, and clears an expired mark", () => {
    const s = memStore();
    markSaveOffer("W12632618", 0, s);
    expect(takeSaveOffer("W12632618", SAVE_OFFER_TTL_MS, s)).toBe(false);
    expect(s.size()).toBe(0);
  });

  it("never throws on junk or missing storage", () => {
    const s = memStore();
    s.setItem("pp_save_offer", "{not json");
    expect(takeSaveOffer("W12632618", 0, s)).toBe(false);
    expect(takeSaveOffer("W12632618", 0, null)).toBe(false);
    expect(() => markSaveOffer("W12632618", 0, null)).not.toThrow();
  });
});
