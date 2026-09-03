import { describe, it, expect } from "vitest";
import {
  ADDRESS_SITEMAP_SHARDS,
  ADDRESS_SITEMAP_WINDOW_MONTHS,
  SHARD_URLS,
  addressSitemapWindowStart,
} from "./addressSitemapShards";

describe("addressSitemapWindowStart", () => {
  it("returns a bare date, not a timestamp", () => {
    expect(addressSitemapWindowStart(new Date("2026-09-02T18:30:00Z"))).toBe("2025-09-02");
  });

  it("walks back exactly ADDRESS_SITEMAP_WINDOW_MONTHS", () => {
    const start = addressSitemapWindowStart(new Date("2026-03-15T00:00:00Z"));
    const [y, m] = start.split("-").map(Number);
    expect(y * 12 + m).toBe(2026 * 12 + 3 - ADDRESS_SITEMAP_WINDOW_MONTHS);
  });
});

describe("shard geometry", () => {
  it("keeps every file under the sitemap protocol's 50,000-URL limit", () => {
    expect(SHARD_URLS).toBeLessThanOrEqual(50_000);
  });

  it("covers the measured 12-month population (122,866 sales on 2026-09-02)", () => {
    // Undersizing silently truncates the tail: the last shard fills and the rest of the
    // window is simply never declared, with nothing to signal it.
    expect(ADDRESS_SITEMAP_SHARDS * SHARD_URLS).toBeGreaterThan(122_866);
  });
});
