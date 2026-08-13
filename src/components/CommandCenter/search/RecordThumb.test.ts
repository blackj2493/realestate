import { describe, it, expect } from "vitest";
import { recordThumbSrc } from "./RecordThumb";

/**
 * The regression this guards (reported live 2026-08-13, "90 osler"): a SIGNED-IN consumer
 * saw the 24px anonymous blur on the leased row X12941486, while /properties/[id] would
 * have shown them the full gallery for the same home. The dropdown had no consumer branch
 * at all — /api/search/address-status shipped `hasPhoto` and nothing else, so every record
 * row went to the blur route regardless of who was asking.
 */
describe("recordThumbSrc", () => {
  it("renders the real photo for a consumer, never the blur", () => {
    const url = "https://cdn.example/photos/X12941486-1.jpg";
    expect(recordThumbSrc("X12941486", true, url)).toBe(url);
  });

  it("trusts a handed-down URL even when the existence bit is stale", () => {
    // The bit comes from the rolling sold_listings doc; the URL from the gated archive
    // read. The archive can have a photo the doc lacks — prefer the thing we actually hold.
    const url = "https://cdn.example/photos/X12888728-1.jpg";
    expect(recordThumbSrc("X12888728", false, url)).toBe(url);
    expect(recordThumbSrc(undefined, undefined, url)).toBe(url);
  });

  it("falls back to the server-side blur for anon when a photo exists", () => {
    expect(recordThumbSrc("X12941486", true)).toBe("/api/property/X12941486/photo-blur");
  });

  it("shows the plain lock when there is no photo and no key", () => {
    expect(recordThumbSrc("X12941486", false)).toBeNull();
    expect(recordThumbSrc(undefined, true)).toBeNull();
    expect(recordThumbSrc()).toBeNull();
  });

  it("never lets a key interpolate into the blur path unescaped", () => {
    expect(recordThumbSrc("X1/../secret", true)).toBe("/api/property/X1%2F..%2Fsecret/photo-blur");
  });
});
