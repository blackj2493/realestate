-- 105: teach the sold RPCs to exclude leases by transaction_type, not by price.
--
-- Both functions from migration 099 take a `p_price_floor` that the callers set to
-- MIN_SALE_PRICE (50,000) — a magnitude test standing in for "this row is a sale".
-- With raw_vow_sold.transaction_type now a real column (migration 104), the
-- category is stated rather than inferred:
--
--     For Sale       255,820
--     For Lease       40,210
--     For Sub-Lease       10
--
-- The proxy leaked no leases in practice (none had closed above $50k) but excluded
-- 482 genuine sales — vacant land, mobile homes, rural residential — and would
-- admit the first lease to close above the line. The active index already carries
-- a lease listed above $100k.
--
-- `p_price_floor` is KEPT in both signatures, deliberately:
--   * changing the signature would drop and recreate the function, and PostgREST
--     would 404 every call in the window between this migration and the deploy;
--   * the parameter still has a job — callers now pass 1, so a $0 placeholder
--     closing stays out of the medians.
-- Only the body changes, so the migration is a pure CREATE OR REPLACE and the
-- existing grants survive untouched.
--
-- `transaction_type = 'For Sale'` matches ~86% of the table, so it is applied as a
-- filter on rows already narrowed by the city / date indexes rather than being
-- indexed itself; an index that selective would never be chosen.

-- ---------------------------------------------------------------------------
-- 1. sold_close_list_rows — getCloseListRatio
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sold_close_list_rows(
  p_city        text,
  p_price_floor numeric,
  p_cutoff      date,
  p_limit       integer
)
RETURNS TABLE (
  close_price       numeric,
  list_price        numeric,
  property_sub_type text
)
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
  SELECT s.close_price,
         s.list_price,
         s.property_sub_type::text
  FROM public.raw_vow_sold s
  WHERE (lower(s.city) = lower(p_city) OR lower(s.city_region) = lower(p_city))
    AND s.transaction_type = 'For Sale'
    AND s.close_price >= p_price_floor
    AND s.purchase_contract_date >= p_cutoff
  -- listing_key breaks ties on purchase_contract_date, so the LIMIT boundary is
  -- reproducible run-to-run (CLAUDE.md §4). See migration 099.
  ORDER BY s.purchase_contract_date DESC, s.listing_key DESC
  LIMIT p_limit
$$;

COMMENT ON FUNCTION public.sold_close_list_rows(text, numeric, date, integer) IS
  'Close/list rows for one municipality or community (getCloseListRatio). Leases '
  'excluded by transaction_type; p_price_floor is a $0-placeholder guard only. '
  'SECURITY INVOKER — service_role only.';

-- ---------------------------------------------------------------------------
-- 2. sold_city_comps — fetchPeerAnchor rung 2
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sold_city_comps(
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
  'transaction_type; p_price_floor is a $0-placeholder guard only. '
  'SECURITY INVOKER — service_role only.';
