-- Migration 041: case-insensitive region indexes on raw_vow_sold (powers region_price_trend).
--
-- raw_vow_sold currently has btree indexes ONLY on city_region (case-sensitive) and
-- listing_key — there is no index on `city`, and no lower() functional index. So the
-- region filter used by region_price_trend / the old price-trend route —
--     (lower(city) = lower($region) OR lower(city_region) = lower($region))
-- — has no usable index and falls back to a full Parallel Seq Scan of ~223k rows
-- (~1.2s each). These two functional indexes let the planner satisfy the OR with a
-- BitmapOr of two index scans, fetching only the region's rows (~7k for Brampton)
-- before aggregating — taking region_price_trend from ~1.3s to ~tens of ms.
--
-- Mirrors the lower(city)/lower(city_region) indexes that already exist on `listings`
-- (idx_listings_city_lower / idx_listings_city_region_lower) and that region_active_
-- aggregates depends on. purchase_contract_date is included as the second key so the
-- 24-month range predicate is also index-served.
--
-- Lean by design: raw_vow_sold is a hot upsert table on a tight Disk IO budget
-- (migration 010 dropped never-read indexes for exactly this reason). Two narrow
-- btrees on already-present columns add minimal write amplification and are justified
-- by being on the read path of every /analytics and dashboard region lookup.
--
-- CONCURRENTLY: raw_vow_sold is upserted by the sync worker; build without an ACCESS
-- EXCLUSIVE lock. CREATE INDEX CONCURRENTLY cannot run inside a transaction block, so
-- each statement must be issued on its own (apply via applyMigration041.ts, which runs
-- them as separate autocommit statements with statement_timeout disabled).

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vow_sold_city_lower_pcd
  ON raw_vow_sold (lower(city), purchase_contract_date DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vow_sold_cityregion_lower_pcd
  ON raw_vow_sold (lower(city_region), purchase_contract_date DESC);
