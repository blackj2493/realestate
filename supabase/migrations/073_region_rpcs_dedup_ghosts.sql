-- Migration 073: dedup relist-ghosts in the active-side region RPCs.
--
-- The listings table accumulates GHOST rows — when a property terminates and relists under
-- a new listing_key, the old row often stays 'active' (the feed just drops it; the ghost
-- cleanup runs on Typesense, not this table). Brampton showed 3,977 active rows for only
-- ~2,602 distinct properties (~1.5x), inflating active_count, months-of-inventory,
-- absorption, stale%, cap sample, and price-cut share — everywhere region_active_aggregates
-- is read (analytics + dashboard + leaderboard).
--
-- FIX: keep one row per property (dedup by coalesce(nullif(property_hash,''),
-- nullif(norm_address,''), listing_key) — hash, else address, else keep; freshest listing
-- by last_seen_at then original_entry_timestamp) via a window
-- function BEFORE aggregating. Query-time, no backfill. Bodies are migration 068/058 with a
-- `ranked`→`active WHERE rn=1` layer added; region_price_cuts also switched to the flat
-- standard_status (068 pattern) and given a sane cut-% band so a bogus total_price_drop
-- (a $20M outlier exists) can't leak in.
--
-- Run: npx tsx scripts/admin/applyMigrationFiles.ts 073_region_rpcs_dedup_ghosts.sql

-- Shared: freshest-row window key comment — keep the currently-live listing per property.

-- ── region_active_aggregates ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION region_active_aggregates(
  p_region text, p_subtypes text[] DEFAULT NULL, p_min_beds integer DEFAULT 0,
  p_min_baths numeric DEFAULT 0, p_min_parking integer DEFAULT 0,
  p_min_frontage numeric DEFAULT 0, p_basement text DEFAULT 'any'
)
RETURNS TABLE (active_count integer, cap_sample integer, median_cap_rate numeric,
  avg_cap_rate numeric, top_cap_rate numeric, stale_count integer)
LANGUAGE sql STABLE SET statement_timeout = '90s'
AS $$
  WITH ranked AS (
    SELECT
      cap_rate_est AS cap,
      GREATEST(true_dom,
        CASE WHEN original_entry_timestamp IS NOT NULL
               THEN GREATEST(0, floor(EXTRACT(EPOCH FROM (now() - original_entry_timestamp)) / 86400))::int
             WHEN full_payload->>'OriginalEntryTimestamp' ~ '^\d{4}-\d{2}-\d{2}'
               THEN GREATEST(0, floor(EXTRACT(EPOCH FROM (now() - (full_payload->>'OriginalEntryTimestamp')::timestamptz)) / 86400))::int
             ELSE 0 END) AS eff_dom,
      row_number() OVER (PARTITION BY coalesce(nullif(property_hash, ''), nullif(norm_address, ''), listing_key)
                         ORDER BY last_seen_at DESC NULLS LAST, original_entry_timestamp DESC NULLS LAST, listing_key DESC) AS rn
    FROM listings
    WHERE (
        lower(city) = lower(p_region) OR lower(city_region) = lower(p_region)
        OR (lower(city) >= lower(p_region) || ' ' AND lower(city) < lower(p_region) || chr(33)
            AND lower(city) ~ ('^' || lower(p_region) || ' [cwe][0-9][0-9]$'))
        OR lower(full_payload->>'CountyOrParish') = lower(p_region))
      AND list_price >= 50000
      AND (p_subtypes IS NULL OR property_sub_type = ANY(p_subtypes))
      AND (p_min_beds     <= 0 OR COALESCE(bedrooms_total,          NULLIF(full_payload->>'BedroomsTotal', '')::numeric)         >= p_min_beds)
      AND (p_min_baths    <= 0 OR COALESCE(bathrooms_total_integer, NULLIF(full_payload->>'BathroomsTotalInteger', '')::numeric) >= p_min_baths)
      AND (p_min_parking  <= 0 OR COALESCE(parking_total,           NULLIF(full_payload->>'ParkingTotal', '')::numeric)          >= p_min_parking)
      AND (p_min_frontage <= 0 OR COALESCE(lot_width,               NULLIF(full_payload->>'LotWidth', '')::numeric)              >= p_min_frontage)
      AND (p_basement = 'any'
        OR (basement_tier IS NOT NULL AND ((p_basement='finished' AND basement_tier BETWEEN 1 AND 5) OR (p_basement='unfinished' AND basement_tier BETWEEN 6 AND 8)))
        OR (basement_tier IS NULL AND ((p_basement='finished' AND full_payload->'Basement' ?| array['Finished','Apartment','Finished with Walk-Out','Partially Finished']) OR (p_basement='unfinished' AND full_payload->'Basement' ? 'Unfinished'))))
      AND COALESCE(standard_status, lower(coalesce(full_payload->>'Status', full_payload->>'MlsStatus', full_payload->>'StandardStatus', '')))
          NOT IN ('sold','closed','closed sale','leased','terminated','expired','suspended')
  ),
  active AS (SELECT cap, eff_dom FROM ranked WHERE rn = 1)
  SELECT
    count(*)::int,
    count(*) FILTER (WHERE cap IS NOT NULL AND cap >= 1 AND cap <= 15)::int,
    round(percentile_cont(0.5) WITHIN GROUP (ORDER BY cap) FILTER (WHERE cap IS NOT NULL AND cap >= 1 AND cap <= 15)::numeric, 2),
    round(avg(cap) FILTER (WHERE cap IS NOT NULL AND cap >= 1 AND cap <= 15), 2),
    round(max(cap) FILTER (WHERE cap IS NOT NULL AND cap >= 1 AND cap <= 15), 2),
    count(*) FILTER (WHERE eff_dom > 60)::int
  FROM active;
$$;

-- ── region_dom_distribution ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION region_dom_distribution(
  p_region text, p_subtypes text[] DEFAULT NULL, p_min_beds integer DEFAULT 0,
  p_min_baths numeric DEFAULT 0, p_min_parking integer DEFAULT 0,
  p_min_frontage numeric DEFAULT 0, p_basement text DEFAULT 'any'
)
RETURNS TABLE (active_count integer, median_true_dom integer, median_naive_dom integer,
  p25_true_dom integer, p75_true_dom integer, dom_0_14 integer, dom_15_30 integer,
  dom_31_60 integer, dom_61_90 integer, dom_90_plus integer)
LANGUAGE sql STABLE SET statement_timeout = '90s'
AS $$
  WITH ranked AS (
    SELECT
      GREATEST(true_dom,
        CASE WHEN original_entry_timestamp IS NOT NULL THEN GREATEST(0, floor(EXTRACT(EPOCH FROM (now() - original_entry_timestamp)) / 86400))::int
             WHEN full_payload->>'OriginalEntryTimestamp' ~ '^\d{4}-\d{2}-\d{2}' THEN GREATEST(0, floor(EXTRACT(EPOCH FROM (now() - (full_payload->>'OriginalEntryTimestamp')::timestamptz)) / 86400))::int
             ELSE 0 END) AS td,
      CASE WHEN original_entry_timestamp IS NOT NULL THEN GREATEST(0, floor(EXTRACT(EPOCH FROM (now() - original_entry_timestamp)) / 86400))::int
           WHEN full_payload->>'OriginalEntryTimestamp' ~ '^\d{4}-\d{2}-\d{2}' THEN GREATEST(0, floor(EXTRACT(EPOCH FROM (now() - (full_payload->>'OriginalEntryTimestamp')::timestamptz)) / 86400))::int
           ELSE NULL END AS naive,
      row_number() OVER (PARTITION BY coalesce(nullif(property_hash, ''), nullif(norm_address, ''), listing_key)
                         ORDER BY last_seen_at DESC NULLS LAST, original_entry_timestamp DESC NULLS LAST, listing_key DESC) AS rn
    FROM listings
    WHERE (
        lower(city) = lower(p_region) OR lower(city_region) = lower(p_region)
        OR (lower(city) >= lower(p_region) || ' ' AND lower(city) < lower(p_region) || chr(33)
            AND lower(city) ~ ('^' || lower(p_region) || ' [cwe][0-9][0-9]$'))
        OR lower(full_payload->>'CountyOrParish') = lower(p_region))
      AND list_price >= 50000
      AND (p_subtypes IS NULL OR property_sub_type = ANY(p_subtypes))
      AND (p_min_beds     <= 0 OR COALESCE(bedrooms_total,          NULLIF(full_payload->>'BedroomsTotal', '')::numeric)         >= p_min_beds)
      AND (p_min_baths    <= 0 OR COALESCE(bathrooms_total_integer, NULLIF(full_payload->>'BathroomsTotalInteger', '')::numeric) >= p_min_baths)
      AND (p_min_parking  <= 0 OR COALESCE(parking_total,           NULLIF(full_payload->>'ParkingTotal', '')::numeric)          >= p_min_parking)
      AND (p_min_frontage <= 0 OR COALESCE(lot_width,               NULLIF(full_payload->>'LotWidth', '')::numeric)              >= p_min_frontage)
      AND (p_basement = 'any'
        OR (basement_tier IS NOT NULL AND ((p_basement='finished' AND basement_tier BETWEEN 1 AND 5) OR (p_basement='unfinished' AND basement_tier BETWEEN 6 AND 8)))
        OR (basement_tier IS NULL AND ((p_basement='finished' AND full_payload->'Basement' ?| array['Finished','Apartment','Finished with Walk-Out','Partially Finished']) OR (p_basement='unfinished' AND full_payload->'Basement' ? 'Unfinished'))))
      AND COALESCE(standard_status, lower(coalesce(full_payload->>'Status', full_payload->>'MlsStatus', full_payload->>'StandardStatus', '')))
          NOT IN ('sold','closed','closed sale','leased','terminated','expired','suspended')
  ),
  active AS (SELECT td, naive FROM ranked WHERE rn = 1)
  SELECT
    count(*)::int,
    round(percentile_cont(0.5)  WITHIN GROUP (ORDER BY td))::int,
    round(percentile_cont(0.5)  WITHIN GROUP (ORDER BY naive))::int,
    round(percentile_cont(0.25) WITHIN GROUP (ORDER BY td))::int,
    round(percentile_cont(0.75) WITHIN GROUP (ORDER BY td))::int,
    count(*) FILTER (WHERE td BETWEEN 0  AND 14)::int,
    count(*) FILTER (WHERE td BETWEEN 15 AND 30)::int,
    count(*) FILTER (WHERE td BETWEEN 31 AND 60)::int,
    count(*) FILTER (WHERE td BETWEEN 61 AND 90)::int,
    count(*) FILTER (WHERE td >= 91)::int
  FROM active;
$$;

-- ── region_price_cuts (dedup + flat status + cut-% sanity band) ─────────────────────────
CREATE OR REPLACE FUNCTION region_price_cuts(
  p_region text, p_subtypes text[] DEFAULT NULL, p_min_beds integer DEFAULT 0,
  p_min_baths numeric DEFAULT 0, p_min_parking integer DEFAULT 0,
  p_min_frontage numeric DEFAULT 0, p_basement text DEFAULT 'any'
)
RETURNS TABLE (active_count integer, cut_count integer, median_cut_amt integer, median_cut_pct numeric)
LANGUAGE sql STABLE SET statement_timeout = '90s'
AS $$
  WITH ranked AS (
    SELECT
      list_price,
      NULLIF(full_payload->>'total_price_drop', '')::numeric AS drop,
      row_number() OVER (PARTITION BY coalesce(nullif(property_hash, ''), nullif(norm_address, ''), listing_key)
                         ORDER BY last_seen_at DESC NULLS LAST, original_entry_timestamp DESC NULLS LAST, listing_key DESC) AS rn
    FROM listings
    WHERE (
        lower(city) = lower(p_region) OR lower(city_region) = lower(p_region)
        OR (lower(city) >= lower(p_region) || ' ' AND lower(city) < lower(p_region) || chr(33)
            AND lower(city) ~ ('^' || lower(p_region) || ' [cwe][0-9][0-9]$'))
        OR lower(full_payload->>'CountyOrParish') = lower(p_region))
      AND list_price >= 50000
      AND (p_subtypes IS NULL OR property_sub_type = ANY(p_subtypes))
      AND (p_min_beds     <= 0 OR COALESCE(bedrooms_total,          NULLIF(full_payload->>'BedroomsTotal', '')::numeric)         >= p_min_beds)
      AND (p_min_baths    <= 0 OR COALESCE(bathrooms_total_integer, NULLIF(full_payload->>'BathroomsTotalInteger', '')::numeric) >= p_min_baths)
      AND (p_min_parking  <= 0 OR COALESCE(parking_total,           NULLIF(full_payload->>'ParkingTotal', '')::numeric)          >= p_min_parking)
      AND (p_min_frontage <= 0 OR COALESCE(lot_width,               NULLIF(full_payload->>'LotWidth', '')::numeric)              >= p_min_frontage)
      AND (p_basement = 'any'
        OR (basement_tier IS NOT NULL AND ((p_basement='finished' AND basement_tier BETWEEN 1 AND 5) OR (p_basement='unfinished' AND basement_tier BETWEEN 6 AND 8)))
        OR (basement_tier IS NULL AND ((p_basement='finished' AND full_payload->'Basement' ?| array['Finished','Apartment','Finished with Walk-Out','Partially Finished']) OR (p_basement='unfinished' AND full_payload->'Basement' ? 'Unfinished'))))
      AND COALESCE(standard_status, lower(coalesce(full_payload->>'Status', full_payload->>'MlsStatus', full_payload->>'StandardStatus', '')))
          NOT IN ('sold','closed','closed sale','leased','terminated','expired','suspended')
  ),
  active AS (
    SELECT list_price, drop,
      -- valid cut = 0.5%..60% of the original ask; excludes noise + garbage ($20M outliers)
      (drop > 0 AND list_price > 0 AND (drop / (list_price + drop)) BETWEEN 0.005 AND 0.6) AS is_cut
    FROM ranked WHERE rn = 1
  )
  SELECT
    count(*)::int,
    count(*) FILTER (WHERE is_cut)::int,
    round(percentile_cont(0.5) WITHIN GROUP (ORDER BY drop) FILTER (WHERE is_cut))::int,
    round(percentile_cont(0.5) WITHIN GROUP (ORDER BY (drop / (list_price + drop) * 100)) FILTER (WHERE is_cut)::numeric, 1)
  FROM active;
$$;

COMMENT ON FUNCTION region_active_aggregates(text, text[], integer, numeric, integer, numeric, text) IS
  'Full-population active-inventory aggregates, DEDUPED by property (migration 073 — one row per property_hash, freshest listing) so relist-ghosts do not inflate active_count/stale/cap. Flat standard_status + original_entry_timestamp (068), no detoast.';
COMMENT ON FUNCTION region_dom_distribution(text, text[], integer, numeric, integer, numeric, text) IS
  'True-DoM distribution, deduped by property (073) + naive-floored via flat original_entry_timestamp (068).';
COMMENT ON FUNCTION region_price_cuts(text, text[], integer, numeric, integer, numeric, text) IS
  'Price-cut pressure, deduped by property (073), flat status, cut-% banded to 0.5-60% so a bogus total_price_drop cannot leak in.';
