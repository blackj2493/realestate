-- Migration 043: Basement filter for the Region Scorecard + price-trend (lens parity)
-- Purpose: complete global-lens parity on the comparison band. The dashboard lens gained
--          a tri-state basement filter (any | finished | unfinished). It already scopes the
--          Typesense New/Sold surfaces; this migration extends the two full-population RPCs
--          so the region medians, cap-rate scalars and sold-trend honor the SAME slice.
--
--          Supersedes the note in migration 027 ("finished-basement is empty on historical
--          sold rows, so it is deliberately NOT scoped server-side"). That is now stale: the
--          June-2026 condition-tier work added raw_vow_sold.basement_tier (deriveBasementTier,
--          backfilled by scripts/admin/backfill-condition-tiers.ts and depended on across the
--          AVM stack), and the active `listings.full_payload` carries the raw `BasementType`.
--          So both sides have the data; this is param + WHERE only — no table writes, no backfill.
--
-- BUILDS ON MIGRATION 042 (NOT 040/031): both function bodies below are copied verbatim from
-- 042 — including the Toronto district-code roll-up region clause and the active RPC's
-- cap_rate_est band (migration 031) — and ONLY add the trailing `p_basement` param + one WHERE
-- clause. (An earlier draft of this migration regressed both by rebuilding from the older
-- 040/027 bodies, which silently dropped the Toronto roll-up — Toronto then matched ~0 rows.)
--
-- Mapping (mirrors src/lib/dashboard/queries.ts + src/app/api/market/activity/sold/soldFilter.ts):
--   ACTIVE (listings.full_payload->'Basement' — a jsonb ARRAY of raw RESO tokens; the Typesense
--           `BasementType` facet is this array verbatim, transformer.ts — so match by containment):
--     finished   ⇒ array overlaps ('Finished','Apartment','Finished with Walk-Out','Partially Finished')
--     unfinished ⇒ array contains 'Unfinished'
--   SOLD (raw_vow_sold.basement_tier, deriveBasementTier 1-9):
--     finished   ⇒ tier 1-5 (finished / partially-finished space)
--     unfinished ⇒ tier 6-8 (unfinished full/partial/crawl; tier 9 = no basement, excluded)
--   any ⇒ no filter (short-circuited so the default scan never touches the field).
--   A NULL BasementType / basement_tier fails every non-'any' predicate, i.e. unknown rows
--   are excluded once a constraint is set — matching the parking/frontage `>=` convention (027).
--
-- Signature change (adds a trailing param), so the prior overload of each RPC is DROPPED to
-- avoid an ambiguous-call error. INSTANT DDL only. raw_vow_sold stays read-only (CLAUDE.md §12).
--
-- Run: npx tsx scripts/admin/applyMigration043.ts   (or paste this file into the SQL editor)

-- Drop the prior overloads (042 signatures) so the new trailing-param signatures are unambiguous.
DROP FUNCTION IF EXISTS region_active_aggregates(text, text[], integer, numeric, integer, numeric);
DROP FUNCTION IF EXISTS region_price_trend(text, text[], integer, numeric, integer, numeric, integer);

-- ── region_price_trend (sold side, raw_vow_sold) — 042 body + p_basement ──────────────────
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
  'Monthly median sold price/$psf + 90d sold-to-list summary for one market area (Toronto district roll-up, migration 042), computed full-population in a single pass. Optionally narrowed by PropertySubType, beds/baths/parking/frontage floors, and basement finish (any|finished|unfinished via basement_tier, migration 043). Returns JSONB {points,summary} — scalars only, no listing rows.';

-- ── region_active_aggregates (active side, listings) — 042 body + p_basement ──────────────
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
      )
      AND list_price >= 50000
      AND (p_subtypes IS NULL OR property_sub_type = ANY(p_subtypes))
      AND (p_min_beds <= 0 OR NULLIF(full_payload->>'BedroomsTotal', '')::numeric >= p_min_beds)
      AND (p_min_baths <= 0 OR NULLIF(full_payload->>'BathroomsTotalInteger', '')::numeric >= p_min_baths)
      AND (p_min_parking <= 0 OR NULLIF(full_payload->>'ParkingTotal', '')::numeric >= p_min_parking)
      AND (p_min_frontage <= 0 OR NULLIF(full_payload->>'LotWidth', '')::numeric >= p_min_frontage)
      -- Basement finish (migration 043). The raw RESO field is `Basement`, a jsonb ARRAY of
      -- tokens (e.g. ["Full","Finished"]); the Typesense `BasementType` facet is that array
      -- verbatim (transformer.ts). So match by array containment, mirroring queries.ts:
      --   finished   ⇒ array overlaps the finished tokens (?|)
      --   unfinished ⇒ array contains 'Unfinished'        (?)
      -- 'any' short-circuits before the jsonb access. full_payload is jsonb, so -> yields jsonb.
      AND (
        p_basement = 'any'
        OR (p_basement = 'finished'
            AND (full_payload->'Basement')
                ?| array['Finished', 'Apartment', 'Finished with Walk-Out', 'Partially Finished'])
        OR (p_basement = 'unfinished'
            AND (full_payload->'Basement') ? 'Unfinished')
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
  'Full-population active-inventory aggregates for one market area (Toronto district roll-up, migration 042), optionally narrowed by PropertySubType, beds/baths/parking/frontage floors, and basement finish (any|finished|unfinished, migration 043). Returns scalars only — no listing rows — so the 100-listing display cap (§6.3b) does not apply.';
