import { describe, it, expect } from "vitest";
import {
  LISTING_ACTIVE_STATUSES,
  LISTING_SHARD_URLS,
  LISTING_SITEMAP_CAPACITY,
  LISTING_SITEMAP_SHARDS,
} from "./listingSitemapShards";

/** Measured against production 2026-09-24:
 *  standard_status IN LISTING_ACTIVE_STATUSES AND is_orphaned = false. */
const ELIGIBLE_AT_LAST_MEASURE = 104_889;

describe("listing sitemap shard geometry", () => {
  it("keeps every file under the sitemap protocol's 50,000-URL limit", () => {
    // At the cap Google rejects the ENTIRE file, not the overflow.
    expect(LISTING_SHARD_URLS).toBeLessThanOrEqual(50_000);
  });

  it("has capacity for the measured population, with headroom", () => {
    // Sized for 18,773 originally — a prefix count off an already-truncated sitemap. The
    // real population is 5.6x that, so 44,889 listings had no file to live in, silently:
    // a shard past the end of the data looks exactly like a shard whose query failed.
    expect(LISTING_SITEMAP_CAPACITY).toBeGreaterThan(ELIGIBLE_AT_LAST_MEASURE);
    // Active inventory swings seasonally and running out is invisible, so require real
    // margin rather than a count that only just fits today.
    expect(LISTING_SITEMAP_CAPACITY).toBeGreaterThan(ELIGIBLE_AT_LAST_MEASURE * 1.25);
  });

  it("pins the statuses the partial index (migration 148) was built for", () => {
    // The index predicate spells these out. Widen this list without widening the index
    // and the planner silently stops using it — which presents as the exact outage it
    // was created to fix: shards timing out and serving an empty <urlset>.
    expect([...LISTING_ACTIVE_STATUSES]).toEqual(["new", "price change", "extension"]);
  });

  it("derives capacity from the two constants rather than restating it", () => {
    expect(LISTING_SITEMAP_CAPACITY).toBe(LISTING_SHARD_URLS * LISTING_SITEMAP_SHARDS);
  });
});
