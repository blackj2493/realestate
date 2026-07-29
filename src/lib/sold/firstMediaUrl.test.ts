import { describe, it, expect } from "vitest";
import { firstMediaUrl } from "./firstMediaUrl";

describe("firstMediaUrl", () => {
  it("returns the first non-empty string URL (the cover photo)", () => {
    expect(firstMediaUrl(["https://a.jpg", "https://b.jpg"])).toBe("https://a.jpg");
  });

  it("skips empty and non-string entries", () => {
    expect(firstMediaUrl(["", null, 3, "https://c.jpg"])).toBe("https://c.jpg");
  });

  it("returns null for a non-array, empty, or all-blank array", () => {
    expect(firstMediaUrl(null)).toBeNull();
    expect(firstMediaUrl(undefined)).toBeNull();
    expect(firstMediaUrl([])).toBeNull();
    expect(firstMediaUrl(["", null])).toBeNull();
    expect(firstMediaUrl("https://x.jpg")).toBeNull();
  });
});
