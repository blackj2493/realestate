-- 136 — sold_fsa_comps / sold_city_comps must RETURN living_area_range.
--
-- `building_area_total` is filled on only 67.4% of sale rows in the 36-month training
-- window. The other 32.6% are not unmeasured homes: 49,819 of them carry the declared
-- MLS band in `living_area_range`, which is the SAME NUMBER wherever both columns exist
-- (171,608 of the 180,619 rows that have building_area_total). The feed simply does not
-- always fill both. Reading the bare column threw a third of the pool's size away.
--
-- A comp with no size is not a comp with no cost. adjustedLogPrice neutralizes it
-- WITHOUT its size term, so whatever made it bigger or smaller than its cohort stays in
-- its adjusted level and lands in the anchor; similarityWeight skips the BW_SQFT term,
-- so it is treated as neither near nor far. And in the fit a null is mean-imputed to
-- z=0, the textbook cause of attenuation — refitting Vellore Village Detached on rows
-- that HAVE the column moves beta_sqft 0.1033 -> 0.1591 and R2 0.708 -> 0.809.
--
-- These functions do NOT coalesce. They RETURN both columns and let features.compSqft
-- decide, because that one TypeScript helper already sizes the direct raw_vow_sold read,
-- the trainer and the backtest harness. Coalescing here as well would create a second
-- definition of "what a size is" that could drift from it — and a comp pool sized
-- differently from the fit is precisely the failure PR #470 fixed, one level down.
--
-- A RETURNS TABLE change cannot go through CREATE OR REPLACE, so each function is
-- dropped and recreated. The whole file runs as one implicit transaction
-- (applyMigrationFiles issues it as a single query), so no caller sees the gap. Grants
-- are re-issued because DROP takes them with it. Parameter lists, bodies, ORDER and
-- LIMIT are byte-for-byte migration 134's definitions plus the one column.
-- Reversible: re-run migration 134 (compSqft then falls back to the bare column).

-- ---------------------------------------------------------------------------
-- 1. sold_city_comps — fetchPeerAnchor rung 2, fetchGeoFallbackAnchor rung 2.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.sold_city_comps(text, text[], numeric, date, integer);

CREATE FUNCTION public.sold_city_comps(
  p_city        text,
  p_sub_types   text[],
  p_price_floor numeric,
  p_cutoff      date,
  p_limit       integer
)
RETURNS TABLE (
  close_price             numeric,
  purchase_contract_date  date,
  close_date              date,
  building_area_total     numeric,
  living_area_range       integer,
  lot_width               numeric,
  lot_depth               numeric,
  bedrooms_above_grade    numeric,
  bedrooms_below_grade    numeric,
  bathrooms_total_integer numeric,
  parking_total           numeric,
  interior_tier           integer,
  exterior_tier           integer,
  basement_tier           integer,
  postal_code             text
)
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
  SELECT s.close_price,
         s.purchase_contract_date,
         s.close_date,
         s.building_area_total,
         s.living_area_range,
         s.lot_width,
         s.lot_depth,
         s.bedrooms_above_grade,
         s.bedrooms_below_grade,
         s.bathrooms_total_integer,
         s.parking_total,
         s.interior_tier,
         s.exterior_tier,
         s.basement_tier,
         s.postal_code::text
  FROM public.raw_vow_sold s
  WHERE lower(s.city) = lower(p_city)
    AND s.property_sub_type = ANY(p_sub_types)
    AND s.transaction_type = 'For Sale'
    AND s.close_price >= p_price_floor
    AND s.purchase_contract_date >= p_cutoff
  ORDER BY s.purchase_contract_date DESC, s.listing_key DESC
  LIMIT p_limit
$$;

COMMENT ON FUNCTION public.sold_city_comps(text, text[], numeric, date, integer) IS
  'City-wide peer comps (fetchPeerAnchor rung 2). Leases excluded by '
  'transaction_type; p_price_floor is a $0-placeholder guard only. Returns every '
  'COMP_SELECT column (anchorService.ts) — keep the two in step. '
  'SECURITY INVOKER — service_role only.';

REVOKE ALL ON FUNCTION public.sold_city_comps(text, text[], numeric, date, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sold_city_comps(text, text[], numeric, date, integer)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 2. sold_fsa_comps — fetchGeoFallbackAnchor rung 1, fetchPeerAnchor rung 1b.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.sold_fsa_comps(text, text, text[], numeric, date, integer);

CREATE FUNCTION public.sold_fsa_comps(
  p_fsa         text,
  p_city        text,
  p_sub_types   text[],
  p_price_floor numeric,
  p_cutoff      date,
  p_limit       integer
)
RETURNS TABLE (
  close_price             numeric,
  purchase_contract_date  date,
  close_date              date,
  building_area_total     numeric,
  living_area_range       integer,
  lot_width               numeric,
  lot_depth               numeric,
  bedrooms_above_grade    numeric,
  bedrooms_below_grade    numeric,
  bathrooms_total_integer numeric,
  parking_total           numeric,
  interior_tier           integer,
  exterior_tier           integer,
  basement_tier           integer,
  postal_code             text
)
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
  SELECT s.close_price,
         s.purchase_contract_date,
         s.close_date,
         s.building_area_total,
         s.living_area_range,
         s.lot_width,
         s.lot_depth,
         s.bedrooms_above_grade,
         s.bedrooms_below_grade,
         s.bathrooms_total_integer,
         s.parking_total,
         s.interior_tier,
         s.exterior_tier,
         s.basement_tier,
         s.postal_code::text
  FROM public.raw_vow_sold s
  WHERE upper(left(btrim(s.postal_code), 3)) = upper(btrim(p_fsa))
    AND lower(s.city) = lower(p_city)
    AND s.property_sub_type = ANY(p_sub_types)
    AND s.transaction_type = 'For Sale'
    AND s.close_price >= p_price_floor
    AND s.purchase_contract_date >= p_cutoff
  ORDER BY s.purchase_contract_date DESC, s.listing_key DESC
  LIMIT p_limit
$$;

COMMENT ON FUNCTION public.sold_fsa_comps(text, text, text[], numeric, date, integer) IS
  'Neighbourhood-scale comps keyed on postal FSA, for subjects whose feed carries no '
  'CityRegion. Called by fetchAnchor when cityRegionLookupCandidates is empty. Returns '
  'every COMP_SELECT column (anchorService.ts) — keep the two in step. '
  'SECURITY INVOKER — service_role only.';

REVOKE ALL ON FUNCTION public.sold_fsa_comps(text, text, text[], numeric, date, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sold_fsa_comps(text, text, text[], numeric, date, integer)
  TO service_role;
