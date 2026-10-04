-- 153: every region RPC resolves grouped regions through region_aliases.
--
-- WHY. Migration 088/089 taught region_price_trend, region_listing_outcomes,
-- region_rental_yield and region_seasonality to expand a grouped region (Ottawa's OREB
-- areas) through region_aliases. The other six never learned it, so a grouped region
-- read 0 active, no True DOM and no cap rate on the dashboard scorecard. Ottawa hid this
-- behind its CountyOrParish fallback; the parts of Toronto ("Scarborough",
-- "Midtown Toronto", src/lib/dashboard/cityParts.ts) have no such fallback.
--
-- WHAT. One added OR term per function, the same uncorrelated `= ANY (ARRAY(...))` form
-- 089 uses (a correlated IN re-runs per row). Nothing else changes: each body below is
-- the LIVE definition from pg_get_functiondef on 2026-10-04 with that one line added, so
-- each function keeps its `SET statement_timeout` (a hand-written CREATE OR REPLACE
-- without it silently drops the setting). The CountyOrParish fallback is left as it is,
-- so no existing region's result can shrink; a region with no alias rows behaves exactly
-- as before.
--
-- Safe to re-run.


CREATE OR REPLACE FUNCTION public.region_active_aggregates(p_region text, p_subtypes text[] DEFAULT NULL::text[], p_min_beds integer DEFAULT 0, p_min_baths numeric DEFAULT 0, p_min_parking integer DEFAULT 0, p_min_frontage numeric DEFAULT 0, p_basement text DEFAULT 'any'::text)
 RETURNS TABLE(active_count integer, cap_sample integer, median_cap_rate numeric, avg_cap_rate numeric, top_cap_rate numeric, stale_count integer)
 LANGUAGE sql
 STABLE
 SET statement_timeout TO '90s'
AS $function$
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
        -- 153: grouped regions (Ottawa, the parts of Toronto), flat column, no detoast.
        OR lower(city) = ANY (ARRAY(SELECT member_city FROM region_aliases WHERE region = lower(p_region)))
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
    SELECT r.cap, r.eff_dom
    FROM ranked r
    WHERE r.rn = 1
      -- Feed-verified liveness (see the header for the scoring and the fail-open rules).
      AND COALESCE(r.last_seen_at, '-infinity'::timestamptz) >= public.feed_liveness_floor()
  )
  SELECT
    count(*)::int,
    count(*) FILTER (WHERE cap IS NOT NULL AND cap >= 1 AND cap <= 15)::int,
    round(percentile_cont(0.5) WITHIN GROUP (ORDER BY cap) FILTER (WHERE cap IS NOT NULL AND cap >= 1 AND cap <= 15)::numeric, 2),
    round(avg(cap) FILTER (WHERE cap IS NOT NULL AND cap >= 1 AND cap <= 15), 2),
    round(max(cap) FILTER (WHERE cap IS NOT NULL AND cap >= 1 AND cap <= 15), 2),
    count(*) FILTER (WHERE eff_dom > 60)::int
  FROM active;
$function$;

CREATE OR REPLACE FUNCTION public.region_avm_reliability(p_region text, p_subtypes text[] DEFAULT NULL::text[])
 RETURNS TABLE(cohort_count integer, sales_analyzed integer, wavg_r2 numeric, wavg_mae_pct numeric)
 LANGUAGE sql
 STABLE
 SET statement_timeout TO '60s'
AS $function$
  WITH regionset AS (
    SELECT DISTINCT lower(city_region) AS cr
    FROM listings
    WHERE city_region IS NOT NULL
      AND (
        lower(city) = lower(p_region)
        OR lower(city_region) = lower(p_region)
        -- 153: grouped regions (Ottawa, the parts of Toronto), flat column, no detoast.
        OR lower(city) = ANY (ARRAY(SELECT member_city FROM region_aliases WHERE region = lower(p_region)))
        OR (
          lower(city) >= lower(p_region) || ' '
          AND lower(city) <  lower(p_region) || chr(33)
          AND lower(city) ~ ('^' || lower(p_region) || ' [cwe][0-9][0-9]$')
        )
      )
  )
  SELECT
    count(*)::int,
    coalesce(sum(a.total_sales_analyzed), 0)::int,
    round((sum(a.model_accuracy_score * a.total_sales_analyzed)
           / NULLIF(sum(a.total_sales_analyzed), 0))::numeric, 3),
    round((sum(a.average_error_margin * a.total_sales_analyzed)
           / NULLIF(sum(a.total_sales_analyzed), 0) * 100)::numeric, 1)
  FROM avm_audit_report a
  WHERE lower(a.city_region) IN (SELECT cr FROM regionset)
    -- Added by migration 132: a city-rung cohort keyed on a name that is ALSO a community
    -- would otherwise be counted a second time.
    AND a.cohort_rung = 'community'
    AND a.total_sales_analyzed > 0
    AND (p_subtypes IS NULL OR a.property_sub_type = ANY (p_subtypes));
$function$;

CREATE OR REPLACE FUNCTION public.region_dom_distribution(p_region text, p_subtypes text[] DEFAULT NULL::text[], p_min_beds integer DEFAULT 0, p_min_baths numeric DEFAULT 0, p_min_parking integer DEFAULT 0, p_min_frontage numeric DEFAULT 0, p_basement text DEFAULT 'any'::text)
 RETURNS TABLE(active_count integer, median_true_dom integer, median_naive_dom integer, p25_true_dom integer, p75_true_dom integer, dom_0_14 integer, dom_15_30 integer, dom_31_60 integer, dom_61_90 integer, dom_90_plus integer)
 LANGUAGE sql
 STABLE
 SET statement_timeout TO '90s'
AS $function$
  WITH scoped AS MATERIALIZED (
    SELECT DISTINCT ON (coalesce(nullif(l.property_hash,''), nullif(l.norm_address,''), l.listing_key))
           l.property_hash,
           l.original_entry_timestamp AS oet_ts,
           COALESCE(l.standard_status,
                    lower(coalesce(l.full_payload->>'Status',
                                   l.full_payload->>'MlsStatus',
                                   l.full_payload->>'StandardStatus',''))) AS eff_status
    FROM listings l
    WHERE (
        lower(l.city) = lower(p_region)
        OR lower(l.city_region) = lower(p_region)
        -- 153: grouped regions (Ottawa, the parts of Toronto), flat column, no detoast.
        OR lower(l.city) = ANY (ARRAY(SELECT member_city FROM region_aliases WHERE region = lower(p_region)))
        OR (lower(l.city) >= lower(p_region) || ' ' AND lower(l.city) < lower(p_region) || chr(33)
            AND lower(l.city) ~ ('^' || lower(p_region) || ' [cwe][0-9][0-9]$'))
        OR lower(l.full_payload->>'CountyOrParish') = lower(p_region))
      AND l.list_price >= 50000
      AND (p_subtypes IS NULL OR l.property_sub_type = ANY(p_subtypes))
      AND (p_min_beds     <= 0 OR COALESCE(l.bedrooms_total,          NULLIF(l.full_payload->>'BedroomsTotal', '')::numeric)         >= p_min_beds)
      AND (p_min_baths    <= 0 OR COALESCE(l.bathrooms_total_integer, NULLIF(l.full_payload->>'BathroomsTotalInteger', '')::numeric) >= p_min_baths)
      AND (p_min_parking  <= 0 OR COALESCE(l.parking_total,           NULLIF(l.full_payload->>'ParkingTotal', '')::numeric)          >= p_min_parking)
      AND (p_min_frontage <= 0 OR COALESCE(l.lot_width,               NULLIF(l.full_payload->>'LotWidth', '')::numeric)              >= p_min_frontage)
      AND (p_basement = 'any'
        OR (l.basement_tier IS NOT NULL AND ((p_basement='finished'   AND l.basement_tier BETWEEN 1 AND 5)
                                          OR (p_basement='unfinished' AND l.basement_tier BETWEEN 6 AND 8)))
        OR (l.basement_tier IS NULL AND ((p_basement='finished' AND l.full_payload->'Basement' ?| array['Finished','Apartment','Finished with Walk-Out','Partially Finished'])
                                      OR (p_basement='unfinished' AND l.full_payload->'Basement' ? 'Unfinished'))))
      -- Feed-verified liveness, measured against the last heartbeat sweep (not now()) so
      -- it holds between weekly sweeps, and FAILS OPEN if the heartbeat stops.
      AND COALESCE(l.last_seen_at, '-infinity'::timestamptz) >= public.feed_liveness_floor()
    -- DO NOT add last_seen_at here (see header).
    ORDER BY coalesce(nullif(l.property_hash,''), nullif(l.norm_address,''), l.listing_key),
             l.original_entry_timestamp DESC NULLS LAST,
             l.listing_key DESC
  ),
  live AS (
    SELECT s.oet_ts, c.stitched_start, c.newest_entry
    FROM scoped s
    LEFT JOIN property_dom_chain c ON c.property_hash = s.property_hash
    -- Keyed on newest_status, NOT on the row existing. property_dom_chain holds a row for
    -- every property in property_campaign_history (180,421) but only 124,929 have a sale
    -- chain; the rest are lease-only and carry NULLs. Testing `c.property_hash IS NOT
    -- NULL` would flip those from the flat-status fallback to an always-false status test
    -- and silently drop them (measured: Toronto 10,021 -> 9,977).
    WHERE CASE
            WHEN c.newest_status IS NOT NULL THEN c.newest_status = 'Active'
            ELSE s.eff_status NOT IN ('sold','closed','closed sale','leased','terminated','expired','suspended')
          END
  ),
  calc AS (
    SELECT
      GREATEST(0, floor(EXTRACT(EPOCH FROM (now() - COALESCE(l.newest_entry, l.oet_ts))) / 86400))::int AS naive,
      GREATEST(0, floor(EXTRACT(EPOCH FROM (now() - COALESCE(l.stitched_start, l.newest_entry, l.oet_ts))) / 86400))::int AS td
    FROM live l
    WHERE COALESCE(l.newest_entry, l.oet_ts) IS NOT NULL
  )
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
  FROM calc;
$function$;

CREATE OR REPLACE FUNCTION public.region_price_cuts(p_region text, p_subtypes text[] DEFAULT NULL::text[], p_min_beds integer DEFAULT 0, p_min_baths numeric DEFAULT 0, p_min_parking integer DEFAULT 0, p_min_frontage numeric DEFAULT 0, p_basement text DEFAULT 'any'::text)
 RETURNS TABLE(active_count integer, cut_count integer, median_cut_amt integer, median_cut_pct numeric)
 LANGUAGE sql
 STABLE
 SET statement_timeout TO '90s'
AS $function$
  WITH ranked AS (
    SELECT
      last_seen_at,
      list_price,
      total_price_drop AS drop,
      row_number() OVER (PARTITION BY coalesce(nullif(property_hash, ''), nullif(norm_address, ''), listing_key)
                         ORDER BY last_seen_at DESC NULLS LAST, original_entry_timestamp DESC NULLS LAST, listing_key DESC) AS rn
    FROM listings
    WHERE (
        lower(city) = lower(p_region) OR lower(city_region) = lower(p_region)
        -- 153: grouped regions (Ottawa, the parts of Toronto), flat column, no detoast.
        OR lower(city) = ANY (ARRAY(SELECT member_city FROM region_aliases WHERE region = lower(p_region)))
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
    SELECT r.list_price, r.drop,
      (r.drop > 0 AND r.list_price > 0 AND (r.drop / (r.list_price + r.drop)) BETWEEN 0.005 AND 0.6) AS is_cut
    FROM ranked r
    WHERE r.rn = 1
      -- Feed-verified liveness (see the header for the scoring and the fail-open rules).
      AND COALESCE(r.last_seen_at, '-infinity'::timestamptz) >= public.feed_liveness_floor()
  )
  SELECT
    count(*)::int,
    count(*) FILTER (WHERE is_cut)::int,
    round(percentile_cont(0.5) WITHIN GROUP (ORDER BY drop) FILTER (WHERE is_cut))::int,
    round(percentile_cont(0.5) WITHIN GROUP (ORDER BY (drop / (list_price + drop) * 100)) FILTER (WHERE is_cut)::numeric, 1)
  FROM active;
$function$;

CREATE OR REPLACE FUNCTION public.region_price_events_summary(p_region text, p_months integer DEFAULT 3)
 RETURNS TABLE(cut_events integer, cut_properties integer, median_cut_pct numeric, median_cut_amt numeric, multi_cut_properties integer)
 LANGUAGE sql
 STABLE
 SET statement_timeout TO '30s'
AS $function$
  WITH ev AS (
    SELECT listing_key, old_price, delta
    FROM price_events
    WHERE (
        lower(city) = lower(p_region)
        OR lower(city_region) = lower(p_region)
        -- 153: grouped regions (Ottawa, the parts of Toronto), flat column, no detoast.
        OR lower(city) = ANY (ARRAY(SELECT member_city FROM region_aliases WHERE region = lower(p_region)))
        OR (
          lower(city) >= lower(p_region) || ' '
          AND lower(city) <  lower(p_region) || chr(33)
          AND lower(city) ~ ('^' || lower(p_region) || ' [cwe][0-9][0-9]$')
        )
      )
      AND event_date >= current_date - make_interval(months => p_months)
      AND delta < 0 AND old_price > 0
  ),
  per_prop AS (SELECT listing_key, count(*) AS n FROM ev GROUP BY listing_key)
  SELECT
    (SELECT count(*)::int FROM ev),
    (SELECT count(*)::int FROM per_prop),
    (SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY (-delta) / old_price))::numeric * 100, 1) FROM ev),
    (SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY -delta))::numeric, 0) FROM ev),
    (SELECT count(*)::int FROM per_prop WHERE n >= 2);
$function$;

CREATE OR REPLACE FUNCTION public.region_sold_dynamics(p_region text, p_subtypes text[] DEFAULT NULL::text[], p_min_beds integer DEFAULT 0, p_min_baths numeric DEFAULT 0, p_min_parking integer DEFAULT 0, p_min_frontage numeric DEFAULT 0, p_months integer DEFAULT 12, p_basement text DEFAULT 'any'::text)
 RETURNS TABLE(sold_count integer, median_dom integer, p25_dom integer, p75_dom integer, median_ppsf integer, p25_ppsf integer, p75_ppsf integer, ppsf_sample integer, ask_gap_median numeric, ask_gap_sample integer, under_ask_share numeric)
 LANGUAGE sql
 STABLE
 SET statement_timeout TO '60s'
AS $function$
  WITH base AS (
    SELECT
      close_price::numeric         AS price,
      -- 109: exact sqft when fed; else banded midpoint (see region_price_trend).
      COALESCE(NULLIF(building_area_total, 0), living_area_range)::numeric AS sqft,
      -- Flat original_list_price (080); raw_payload fallback keeps un-backfilled rows correct.
      COALESCE(original_list_price, NULLIF(raw_payload->>'OriginalListPrice', '')::numeric) AS olp,
      -- Flat days_on_market (board value); else flat listing_contract_date span; else the
      -- raw_payload equivalents (transition-window fallback only). Once backfilled the flat
      -- columns win and raw_payload is never detoasted.
      COALESCE(
        days_on_market,
        CASE WHEN listing_contract_date IS NOT NULL
             THEN GREATEST(0, purchase_contract_date - listing_contract_date)
             ELSE NULL END,
        NULLIF(raw_payload->>'DaysOnMarket', '')::numeric,
        CASE WHEN raw_payload->>'ListingContractDate' ~ '^\d{4}-\d{2}-\d{2}'
             THEN GREATEST(0, purchase_contract_date - (raw_payload->>'ListingContractDate')::date)
             ELSE NULL END
      )                            AS dom
    FROM raw_vow_sold
    WHERE (
        lower(city) = lower(p_region)
        OR lower(city_region) = lower(p_region)
        -- 153: grouped regions (Ottawa, the parts of Toronto), flat column, no detoast.
        OR lower(city) = ANY (ARRAY(SELECT member_city FROM region_aliases WHERE region = lower(p_region)))
        OR (
          lower(city) >= lower(p_region) || ' '
          AND lower(city) <  lower(p_region) || chr(33)
          AND lower(city) ~ ('^' || lower(p_region) || ' [cwe][0-9][0-9]$')
        )
        OR lower(raw_payload->>'CountyOrParish') = lower(p_region)
      )
      AND transaction_type = 'For Sale'
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
  dom_band AS (
    SELECT dom FROM base WHERE dom IS NOT NULL AND dom >= 0 AND dom <= 730
  ),
  ppsf_band AS (
    SELECT price / sqft AS ppsf FROM base WHERE sqft > 0 AND price / sqft BETWEEN 50 AND 5000
  ),
  gap_band AS (
    SELECT (price - olp) / olp AS gap, (price < olp) AS under
    FROM base
    WHERE olp > 50000 AND (price - olp) / olp BETWEEN -0.6 AND 0.6
  )
  SELECT
    (SELECT count(*)::int FROM base),
    (SELECT round(percentile_cont(0.5)  WITHIN GROUP (ORDER BY dom))::int  FROM dom_band),
    (SELECT round(percentile_cont(0.25) WITHIN GROUP (ORDER BY dom))::int  FROM dom_band),
    (SELECT round(percentile_cont(0.75) WITHIN GROUP (ORDER BY dom))::int  FROM dom_band),
    (SELECT round(percentile_cont(0.5)  WITHIN GROUP (ORDER BY ppsf))::int FROM ppsf_band),
    (SELECT round(percentile_cont(0.25) WITHIN GROUP (ORDER BY ppsf))::int FROM ppsf_band),
    (SELECT round(percentile_cont(0.75) WITHIN GROUP (ORDER BY ppsf))::int FROM ppsf_band),
    (SELECT count(*)::int FROM ppsf_band),
    (SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY gap) * 100)::numeric, 1) FROM gap_band),
    (SELECT count(*)::int FROM gap_band),
    (SELECT round(avg(CASE WHEN under THEN 1 ELSE 0 END), 3) FROM gap_band);
$function$;
