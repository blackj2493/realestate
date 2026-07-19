-- Migration 082: (A) drop provably-dead ghosts from the active-side RPCs via a last_seen_at
-- freshness gate, and (B) add avgPrice to region_price_trend so /analytics can show the
-- board-comparable AVERAGE beside our median.
--
-- WHY (A): migration 073 deduped RELIST ghosts (one row per property_hash), but a listing
-- that terminates/expires and is simply DROPPED from the feed WITHOUT a status update stays
-- standard_status='active' forever — 073's status filter can't catch it and dedup keeps it
-- (it's the only row for that property). Audit (2026-07-18, City of Toronto): 14,624 "active"
-- but 3,926 had a real last_seen_at older than 30 days (proven not seen in a month). TRREB's
-- June month-end 416 active = 10,047; our pool inflated ~+46%, cratering months-of-inventory
-- (~9 vs board 4.7) and faking a 57% stale share.
--
-- FIX (A): keep a property only when its freshest row was seen within 30 days OR has a NULL
-- last_seen_at (≈40% of rows are never stamped — treat unknown as live so we NEVER drop a
-- genuinely-live listing; we only remove rows with POSITIVE evidence of death). Result:
-- Toronto 14,624→10,698 (TRREB +6.5%), Mississauga 3,797→2,815 (TRREB +8.7%) — matches the
-- board across two independent markets. Applied to region_active_aggregates,
-- region_dom_distribution, region_price_cuts (every active-side reader). is_orphaned is NOT
-- used — it is 0 for the entire active pool (the orphan sweep is not populating it).
--
-- WHY (B): TRREB/CREA headline the AVERAGE; we headline the MEDIAN (~29% lower in the 416 due
-- to condo mix), so a naive comparison makes us look ~22% low. Surfacing both kills the
-- confusion. Same pattern as 059 (one added column in `monthly`; to_jsonb(m) carries it).
--
-- Additive / CREATE OR REPLACE only (signatures unchanged). GUCs reset on REPLACE so
-- statement_timeout is re-declared. Run: npx tsx scripts/admin/applyMigrationFiles.ts 082_active_freshness_and_avg_price.sql

-- ── region_active_aggregates (+ freshness gate) ─────────────────────────────────────────
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
      last_seen_at,
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
  -- freshness gate: drop a property only when its freshest row was PROVABLY seen >30d ago;
  -- NULL last_seen_at (never stamped) is treated as live so no genuine listing is dropped.
  active AS (SELECT cap, eff_dom FROM ranked WHERE rn = 1
             AND (last_seen_at IS NULL OR last_seen_at >= now() - interval '30 days'))
  SELECT
    count(*)::int,
    count(*) FILTER (WHERE cap IS NOT NULL AND cap >= 1 AND cap <= 15)::int,
    round(percentile_cont(0.5) WITHIN GROUP (ORDER BY cap) FILTER (WHERE cap IS NOT NULL AND cap >= 1 AND cap <= 15)::numeric, 2),
    round(avg(cap) FILTER (WHERE cap IS NOT NULL AND cap >= 1 AND cap <= 15), 2),
    round(max(cap) FILTER (WHERE cap IS NOT NULL AND cap >= 1 AND cap <= 15), 2),
    count(*) FILTER (WHERE eff_dom > 60)::int
  FROM active;
$$;

-- ── region_dom_distribution (+ freshness gate) ──────────────────────────────────────────
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
      last_seen_at,
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
  active AS (SELECT td, naive FROM ranked WHERE rn = 1
             AND (last_seen_at IS NULL OR last_seen_at >= now() - interval '30 days'))
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

-- ── region_price_cuts (+ freshness gate) ────────────────────────────────────────────────
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
      last_seen_at,
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
      (drop > 0 AND list_price > 0 AND (drop / (list_price + drop)) BETWEEN 0.005 AND 0.6) AS is_cut
    FROM ranked WHERE rn = 1
      AND (last_seen_at IS NULL OR last_seen_at >= now() - interval '30 days')
  )
  SELECT
    count(*)::int,
    count(*) FILTER (WHERE is_cut)::int,
    round(percentile_cont(0.5) WITHIN GROUP (ORDER BY drop) FILTER (WHERE is_cut))::int,
    round(percentile_cont(0.5) WITHIN GROUP (ORDER BY (drop / (list_price + drop) * 100)) FILTER (WHERE is_cut)::numeric, 1)
  FROM active;
$$;

-- ── region_price_trend (+ avgPrice per month) ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION region_price_trend(
  p_region      text,
  p_subtypes    text[]  DEFAULT NULL,
  p_min_beds    integer DEFAULT 0,
  p_min_baths   numeric DEFAULT 0,
  p_min_parking integer DEFAULT 0,
  p_min_frontage numeric DEFAULT 0,
  p_months      integer DEFAULT 24,
  p_basement    text    DEFAULT 'any'
)
RETURNS jsonb
LANGUAGE sql STABLE SET statement_timeout = '60s'
AS $$
  WITH base AS (
    SELECT
      close_price::numeric            AS price,
      list_price::numeric             AS list,
      purchase_contract_date::date    AS pcd,
      building_area_total::numeric    AS sqft
    FROM raw_vow_sold
    WHERE (
        lower(city) = lower(p_region)
        OR lower(city_region) = lower(p_region)
        OR (
          lower(city) >= lower(p_region) || ' '
          AND lower(city) <  lower(p_region) || chr(33)
          AND lower(city) ~ ('^' || lower(p_region) || ' [cwe][0-9][0-9]$')
        )
        OR lower(raw_payload->>'CountyOrParish') = lower(p_region)
      )
      AND close_price >= 50000
      AND purchase_contract_date >= (current_date - make_interval(months => p_months))
      AND (p_subtypes IS NULL OR property_sub_type = ANY (p_subtypes))
      AND (p_min_beds = 0     OR bedrooms_above_grade    >= p_min_beds)
      AND (p_min_baths = 0    OR bathrooms_total_integer >= p_min_baths)
      AND (p_min_parking = 0  OR parking_total           >= p_min_parking)
      AND (p_min_frontage = 0 OR lot_width               >= p_min_frontage)
      AND (
        p_basement = 'any'
        OR (p_basement = 'finished'   AND basement_tier BETWEEN 1 AND 5)
        OR (p_basement = 'unfinished' AND basement_tier BETWEEN 6 AND 8)
      )
  ),
  monthly AS (
    SELECT
      to_char(date_trunc('month', pcd), 'YYYY-MM')                                   AS month,
      round(percentile_cont(0.5) WITHIN GROUP (ORDER BY price))::int                 AS "medianPrice",
      round(avg(price))::int                                                         AS "avgPrice",
      round(percentile_cont(0.5) WITHIN GROUP (ORDER BY price / NULLIF(sqft, 0))
            FILTER (WHERE sqft > 0))::int                                            AS "medianPpsf",
      count(*)::int                                                                  AS sales,
      round(avg(price / list) FILTER (WHERE list >= 50000 AND price / list > 0.5 AND price / list < 2) * 100, 1)
                                                                                     AS "soldToList"
    FROM base
    GROUP BY 1
    ORDER BY 1
  ),
  s90 AS (
    SELECT
      count(*)::int AS sales90,
      count(*) FILTER (WHERE list >= 50000 AND price / list > 0.5 AND price / list < 2)::int AS with_list,
      avg(price / list) FILTER (WHERE list >= 50000 AND price / list > 0.5 AND price / list < 2) AS ratio_avg,
      count(*) FILTER (WHERE list >= 50000 AND price / list > 0.5 AND price / list < 2 AND price > list)::int AS over_ask
    FROM base
    WHERE pcd >= current_date - 90
  )
  SELECT jsonb_build_object(
    'points',
      coalesce((SELECT jsonb_agg(to_jsonb(m)) FROM monthly m), '[]'::jsonb),
    'summary',
      (SELECT jsonb_build_object(
        'sales90',           sales90,
        'listPriceCoverage', round(CASE WHEN sales90 > 0 THEN with_list::numeric / sales90 ELSE 0 END, 2),
        'soldToListPct',     CASE WHEN with_list >= 10 AND with_list::numeric / NULLIF(sales90, 0) >= 0.5
                                  THEN round(ratio_avg * 100, 1) ELSE NULL END,
        'pctOverAsking',     CASE WHEN with_list >= 10 AND with_list::numeric / NULLIF(sales90, 0) >= 0.5
                                  THEN round(over_ask::numeric / with_list * 100, 1) ELSE NULL END
      ) FROM s90)
  );
$$;

COMMENT ON FUNCTION region_active_aggregates(text, text[], integer, numeric, integer, numeric, text) IS
  'Full-population active-inventory aggregates, deduped by property (073) + last_seen_at>30d freshness gate (082 — drops terminated-without-status ghosts; NULL last_seen kept as live). Flat status/entry (068), no detoast.';
COMMENT ON FUNCTION region_dom_distribution(text, text[], integer, numeric, integer, numeric, text) IS
  'True-DoM distribution, deduped (073) + last_seen_at>30d freshness gate (082), naive-floored via flat original_entry_timestamp (068).';
COMMENT ON FUNCTION region_price_cuts(text, text[], integer, numeric, integer, numeric, text) IS
  'Price-cut pressure, deduped (073) + last_seen_at>30d freshness gate (082), flat status, cut-% banded 0.5-60%.';
COMMENT ON FUNCTION region_price_trend(text, text[], integer, numeric, integer, numeric, integer, text) IS
  'Monthly median + avg (082) sold price/$psf/sales + per-month soldToList (059) + 90d summary. Region match: city/city_region, Toronto district roll-up (042), CountyOrParish roll-up (047). Returns JSONB {points,summary}.';
