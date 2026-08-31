-- 134 — sold_fsa_comps / sold_city_comps must RETURN bedrooms_below_grade.
--
-- anchorService.COMP_SELECT has carried bedrooms_below_grade since the den split
-- (#381-#383): the subject premium includes the plus-room term, so every comp must be
-- neutralized with it too, or the difference sits in the anchor. The direct
-- raw_vow_sold read selects it. These two RPCs — the FSA rung of the anchor and peer
-- search (migration 112) and the city-wide peer rung (migrations 099/105) — were never
-- updated, so their rows reached adjustedLogPrice with the column ABSENT.
--
-- Absent is `undefined`, not `null`, and the null-skip did not catch it:
-- (undefined − mean) / std is NaN, so the moment any coefficients with a non-zero den
-- beta were applied, EVERY comp from these rungs was dropped. The anchor fell to the
-- prior alone (predSD 0.22 → LOW) and the peer search found nothing (→ floor). Trained
-- outliers whose community had too few peers hit this on the city-wide rung already;
-- #452 hit it on every Waterloo Region listing at once, and #458 reverted the ladder
-- for what was really this.
--
-- A RETURNS TABLE change cannot go through CREATE OR REPLACE, so each function is
-- dropped and recreated. The whole file runs as one implicit transaction
-- (applyMigrationFiles issues it as a single query), so no caller sees the gap. Grants
-- are re-issued because DROP takes them with it. Parameter lists, bodies, ORDER and
-- LIMIT are byte-for-byte the previous definitions plus the one column.
-- Reversible: re-run migrations 105 and 112 (anchorService then skips the feature).

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
