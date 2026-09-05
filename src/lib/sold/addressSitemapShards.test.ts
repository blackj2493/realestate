import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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

describe('the route must not be prerendered at build', () => {
  it('declares force-dynamic and no build-time revalidate', () => {
    // Read the source rather than import it: importing the route pulls in the live
    // Typesense/Supabase clients. This is a static contract, so check it statically.
    const src = readFileSync(
      join(process.cwd(), 'src/app/addresses/sitemap.ts'),
      'utf8'
    );
    // Seven EMPTY shards reached production because the build generated them alongside
    // 57 other prerenders and the queries timed out under that contention. A build-time
    // `revalidate` here reintroduces exactly that.
    expect(src).toMatch(/export const dynamic = "force-dynamic"/);
    expect(src).not.toMatch(/export const revalidate/);
  });
});
