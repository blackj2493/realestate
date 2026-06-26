-- Migration 047: CountyOrParish municipality roll-up in both region RPCs — fixes Ottawa.
--
-- PROBLEM: region_price_trend('Ottawa') / region_active_aggregates('Ottawa') returned ZERO
-- rows, so /analytics, the Region Scorecard, Submarket Leaderboard and Market Pulse showed
-- "—" (incl. YoY) for the entire Ottawa market. Root cause: the City of Ottawa is NOT stored
-- as a bare "Ottawa" nor as prefixed district codes (the Toronto case, migration 042). Its
-- ~15 OREB districts are stored as SEPARATE, prefix-less `city` values — Kanata, Barrhaven,
-- "Orleans - Convent Glen and Area", "Ottawa Centre", "Glebe - Ottawa East and Area", … — so
-- neither the exact `lower(city)=region` match nor the Toronto prefix-range trick can reach
-- them. Verified on prod: 12,524 sold rows (11,784 in the trailing 24mo, all 15 districts) and
-- 3,758 active rows exist, every one carrying raw_payload.CountyOrParish = 'Ottawa'.
--
-- FIX: add ONE region-match branch to each RPC — `lower(CountyOrParish) = lower(p_region)` —
-- reading the RESO municipality field (raw_payload->>'CountyOrParish' on raw_vow_sold,
-- full_payload->>'CountyOrParish' on listings). This generalises migration 042: it folds ANY
-- amalgamated single-tier municipality's districts up to its name (Ottawa now; Toronto already
-- works and is harmlessly re-matched; Hamilton is unaffected — its communities already sit under
-- city='Hamilton'). It is SAFE for the working two-tier cities: Mississauga/Brampton carry
-- CountyOrParish='Peel', Markham/Vaughan='York', Oakville/Milton='Halton', Oshawa/Ajax='Durham'
-- — i.e. their UPPER-tier region, never their own name — so picking the CITY never matches via
-- this branch (verified per-city on prod). No false-merge.
--
-- PERFORMANCE: CountyOrParish lives only in the TOASTed jsonb payload — an unindexed
-- `lower(payload->>'CountyOrParish')=…` predicate detoasts the whole table and BLOWS the 60s
-- statement_timeout (observed). So this branch is made index-usable by two expression indexes
-- created by the apply script with CREATE INDEX CONCURRENTLY (they cannot run inside the
-- multi-statement DDL batch below, and the build needs statement_timeout disabled):
--     idx_vow_sold_county_lower  ON raw_vow_sold (lower(raw_payload->>'CountyOrParish'))
--     idx_listings_county_lower  ON listings     (lower(full_payload->>'CountyOrParish'))
-- With them present the planner adds the branch to the existing BitmapOr (lower(city)/
-- lower(city_region)); for non-single-tier regions it matches 0 rows at negligible cost.
--
-- BUILDS ON: region_price_trend = migration 043 body (basement param) + 044 statement_timeout;
--            region_active_aggregates = migration 046 body (flat dimension columns) — both are
-- copied VERBATIM and ONLY the region clause gains the county branch. CREATE OR REPLACE resets
-- a function's GUCs, so `SET statement_timeout='60s'` (migration 044) is re-declared on BOTH.
-- Signatures unchanged ⇒ no DROP needed. Instant DDL for the two functions.
--
-- Run: npx tsx scripts/admin/applyMigration047.ts   (creates the indexes, then applies this file)

-- ── region_price_trend (sold side, raw_vow_sold) — 043 body + county branch ────────────────
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
LANGUAGE sql
STABLE
SET statement_timeout = '60s'  -- re-declared from migration 044 (CREATE OR REPLACE resets GUCs)
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
        -- Toronto district-code roll-up (migration 042). Index-usable range + strict recheck.
        OR (
          lower(city) >= lower(p_region) || ' '
          AND lower(city) <  lower(p_region) || chr(33)
          AND lower(city) ~ ('^' || lower(p_region) || ' [cwe][0-9][0-9]$')
        )
        -- CountyOrParish municipality roll-up (migration 047) — reaches Ottawa's prefix-less
        -- district city values (Kanata/Barrhaven/…). Index-usable via idx_vow_sold_county_lower.
        OR lower(raw_payload->>'CountyOrParish') = lower(p_region)
      )
      AND close_price >= 50000
      AND purchase_contract_date >= (current_date - make_interval(months => p_months))
      AND (p_subtypes IS NULL OR property_sub_type = ANY (p_subtypes))
      AND (p_min_beds = 0     OR bedrooms_above_grade    >= p_min_beds)
      AND (p_min_baths = 0    OR bathrooms_total_integer >= p_min_baths)
      AND (p_min_parking = 0  OR parking_total           >= p_min_parking)
      AND (p_min_frontage = 0 OR lot_width               >= p_min_frontage)
      -- Basement finish (migration 043), via the derived flat basement_tier (1-9).
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
      round(percentile_cont(0.5) WITHIN GROUP (ORDER BY price / NULLIF(sqft, 0))
            FILTER (WHERE sqft > 0))::int                                            AS "medianPpsf",
      count(*)::int                                                                  AS sales
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

COMMENT ON FUNCTION region_price_trend(text, text[], integer, numeric, integer, numeric, integer, text) IS
  'Monthly median sold price/$psf + 90d sold-to-list summary for one market area. Region match: exact city/city_region, Toronto district roll-up (042), and CountyOrParish municipality roll-up (047, fixes Ottawa). Optionally narrowed by PropertySubType, beds/baths/parking/frontage floors and basement finish (043). Returns JSONB {points,summary} — scalars only.';

-- ── region_active_aggregates (active side, listings) — 046 body + county branch ────────────
CREATE OR REPLACE FUNCTION region_active_aggregates(
  p_region      text,
  p_subtypes    text[]  DEFAULT NULL,
  p_min_beds    integer DEFAULT 0,
  p_min_baths   numeric DEFAULT 0,
  p_min_parking integer DEFAULT 0,
  p_min_frontage numeric DEFAULT 0,
  p_basement    text    DEFAULT 'any'
)
RETURNS TABLE (
  active_count    integer,
  cap_sample      integer,
  median_cap_rate numeric,
  avg_cap_rate    numeric,
  top_cap_rate    numeric,
  stale_count     integer
)
LANGUAGE sql
STABLE
SET statement_timeout = '60s'
AS $$
  WITH active AS (
    SELECT cap_rate_est AS cap, is_stale
    FROM listings
    WHERE (
        lower(city) = lower(p_region)
        OR lower(city_region) = lower(p_region)
        -- Toronto district-code roll-up (migration 042). Index-usable range + strict recheck.
        OR (
          lower(city) >= lower(p_region) || ' '
          AND lower(city) <  lower(p_region) || chr(33)
          AND lower(city) ~ ('^' || lower(p_region) || ' [cwe][0-9][0-9]$')
        )
        -- CountyOrParish municipality roll-up (migration 047). Index-usable via idx_listings_county_lower.
        OR lower(full_payload->>'CountyOrParish') = lower(p_region)
      )
      AND list_price >= 50000
      AND (p_subtypes IS NULL OR property_sub_type = ANY(p_subtypes))
      -- Beds/baths/parking/frontage floors — flat columns (migration 045) with a
      -- full_payload fallback ONLY when the flat value is NULL (not yet backfilled).
      AND (p_min_beds     <= 0 OR COALESCE(bedrooms_total,          NULLIF(full_payload->>'BedroomsTotal', '')::numeric)         >= p_min_beds)
      AND (p_min_baths    <= 0 OR COALESCE(bathrooms_total_integer, NULLIF(full_payload->>'BathroomsTotalInteger', '')::numeric) >= p_min_baths)
      AND (p_min_parking  <= 0 OR COALESCE(parking_total,           NULLIF(full_payload->>'ParkingTotal', '')::numeric)          >= p_min_parking)
      AND (p_min_frontage <= 0 OR COALESCE(lot_width,               NULLIF(full_payload->>'LotWidth', '')::numeric)              >= p_min_frontage)
      -- Basement finish (migration 046). Flat basement_tier bands; fall back to 043's
      -- BasementType-array containment only when basement_tier IS NULL.
      AND (
        p_basement = 'any'
        OR (basement_tier IS NOT NULL AND (
              (p_basement = 'finished'   AND basement_tier BETWEEN 1 AND 5)
           OR (p_basement = 'unfinished' AND basement_tier BETWEEN 6 AND 8)))
        OR (basement_tier IS NULL AND (
              (p_basement = 'finished'
                 AND full_payload->'Basement' ?| array['Finished', 'Apartment', 'Finished with Walk-Out', 'Partially Finished'])
           OR (p_basement = 'unfinished'
                 AND full_payload->'Basement' ? 'Unfinished')))
      )
      AND lower(coalesce(full_payload->>'Status', full_payload->>'MlsStatus', full_payload->>'StandardStatus', ''))
          NOT IN ('sold', 'closed', 'closed sale', 'leased', 'terminated', 'expired', 'suspended')
  )
  SELECT
    count(*)::int AS active_count,
    count(*) FILTER (WHERE cap IS NOT NULL AND cap >= 1 AND cap <= 15)::int AS cap_sample,
    round(percentile_cont(0.5) WITHIN GROUP (ORDER BY cap)
          FILTER (WHERE cap IS NOT NULL AND cap >= 1 AND cap <= 15)::numeric, 2) AS median_cap_rate,
    round(avg(cap) FILTER (WHERE cap IS NOT NULL AND cap >= 1 AND cap <= 15), 2) AS avg_cap_rate,
    round(max(cap) FILTER (WHERE cap IS NOT NULL AND cap >= 1 AND cap <= 15), 2) AS top_cap_rate,
    count(*) FILTER (WHERE is_stale)::int AS stale_count
  FROM active;
$$;

COMMENT ON FUNCTION region_active_aggregates(text, text[], integer, numeric, integer, numeric, text) IS
  'Full-population active-inventory aggregates for one market area. Region match: exact city/city_region, Toronto district roll-up (042), CountyOrParish municipality roll-up (047, fixes Ottawa). Floors read flat dimension columns (045/046) with a full_payload fallback; basement uses basement_tier bands. Returns scalars only (§6.3b).';
