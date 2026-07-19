-- Migration 079: case-insensitive region indexes on raw_vow_delisted.
--
-- region_listing_outcomes (072) filters raw_vow_delisted by lower(city) / lower(city_region)
-- (equality + the Toronto "<name> c/w/e NN" district range), but the only index on the
-- table is idx_raw_vow_delisted_city_date on the RAW, case-sensitive `city` (035). A
-- lower(...) predicate cannot use it, so the RPC sequential-scans raw_vow_delisted on
-- every call — and that RPC is on BOTH hot paths (the /analytics batch AND every dashboard
-- region tile). Measured: region_listing_outcomes ran 2-8s for large regions.
--
-- These functional indexes mirror the sold/listings side (idx_vow_sold_city_lower_pcd,
-- idx_listings_city_lower). delisted_date DESC is folded in so the trailing-window filter
-- (delisted_date >= now - p_months) is index-covered too. Toronto's district regex uses the
-- range predicate on lower(city), which a btree on lower(city) also serves.
--
-- Additive, read-only to data. CREATE INDEX CONCURRENTLY so it never locks the table the
-- nightly delisted-sync writes to — run OUTSIDE a transaction (applied via pg autocommit,
-- same as the 047 county indexes). raw_vow_delisted has no raw_payload, so no CountyOrParish
-- branch here (see 072).

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_raw_vow_delisted_city_lower
  ON raw_vow_delisted (lower(city), delisted_date DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_raw_vow_delisted_cityregion_lower
  ON raw_vow_delisted (lower(city_region), delisted_date DESC);
