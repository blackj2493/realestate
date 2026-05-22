-- ============================================================================
-- Drop unused indexes to relieve Disk IO pressure (2026-05-19)
-- ============================================================================
--
-- Context: Supabase project pyzgnivilxhnwzfrdkiq tripped the Disk IO Budget
-- alert. Audit of pg_stat_user_indexes showed every non-unique index on
-- `listings` and `raw_vow_sold` had ZERO scans since stats were last reset,
-- yet they were all being maintained on every UPSERT. The GIN index on
-- listings.full_payload (175 MB, 0 reads) was the single largest write-side
-- amplifier — GIN-on-JSONB rewrites the token map on every row change.
--
-- KEEP: idx_listings_property_hash (477k scans), idx_vow_sold_region_date
--       (11 scans, used by AVM anchor), all *_pkey / *_key_key unique idx.
--
-- Reversal: any DROP'd index can be CREATEd again in seconds if a future
-- query needs it. None of these touch data.
--
-- Note: `CONCURRENTLY` is intentionally omitted. Supabase SQL Editor wraps
-- every batch in a transaction, and `DROP INDEX CONCURRENTLY` cannot run
-- inside a transaction block (Postgres error 25001). Plain `DROP INDEX`
-- takes a brief ACCESS EXCLUSIVE lock, but the operation itself is
-- metadata-only — even the 175 MB GIN index unlinks in well under a
-- second, since there's no data to rewrite.
-- ============================================================================

-- TIER 1: largest write amplifier
DROP INDEX IF EXISTS public.idx_listings_full_payload_gin;
DROP INDEX IF EXISTS public.idx_vow_sold_hash;

-- TIER 2: small never-read indexes on hot upsert table
DROP INDEX IF EXISTS public.idx_listings_city_price;
DROP INDEX IF EXISTS public.idx_listings_monthly_carry_cost;
DROP INDEX IF EXISTS public.idx_listings_property_sub_type;
DROP INDEX IF EXISTS public.idx_listings_city;
DROP INDEX IF EXISTS public.idx_listings_price;
DROP INDEX IF EXISTS public.idx_listings_suite_status;
DROP INDEX IF EXISTS public.idx_listings_true_dom;
DROP INDEX IF EXISTS public.idx_listings_needs_geocoding;
DROP INDEX IF EXISTS public.idx_listings_payload_hash_nonnull;
