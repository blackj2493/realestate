-- 099_sold_city_lookup_rpcs.sql
--
-- Finding 1 (DB audit 2026-07-27): the three hottest queries in the database all
-- filter raw_vow_sold with `city ILIKE $1`. ILIKE is the pattern operator (~~*),
-- so the planner cannot prove it matches the expression indexes
--
--   idx_vow_sold_city_lower_pcd        btree (lower(city),        purchase_contract_date DESC)
--   idx_vow_sold_cityregion_lower_pcd  btree (lower(city_region), purchase_contract_date DESC)
--
-- and falls back to a parallel seq scan of ~289k rows on every call. Measured on
-- prod: 408 ms / 34,749 buffers (seq scan) vs 34.7 ms / 5,903 buffers once the same
-- predicate is written as lower(col) = lower($1) and the existing indexes are used.
--
-- Those three statements accounted for 82% of all DB time and 85% of all physical
-- reads over the 4.2-day window ending 2026-07-27 (10.4 h of 12.6 h; 379 GB read by
-- the top statement alone).
--
-- PostgREST cannot express `lower(col) = $1`, so the fix is these three RPCs. The
-- rewrite is semantics-preserving: every callsite passes a bare, trimmed city name
-- with no wildcards (see src/lib/avm/normalizeType.ts:138 — ".ilike(key) with no
-- wildcards is case-insensitive .eq"). Under equality a stray '%' becomes a literal
-- that matches nothing, which also closes the unvalidated-`city` amplification on
-- /api/avm, /api/avm/hidden-equity and /api/estimates/sale-price.
--
-- No new indexes, no new columns, no data migration.
--
-- SECURITY: SECURITY INVOKER (the default) + STABLE. raw_vow_sold has RLS ENABLED
-- with no policies, so a SECURITY DEFINER function would bypass RLS and expose VOW
-- sold data to anon/authenticated — a compliance breach. EXECUTE is granted to
-- service_role only; all three callers use getServiceRoleClient(). This is strictly
-- no wider than today's access.

-- ---------------------------------------------------------------------------
-- 1. getCloseListRatio  (was 74,736 calls @ 273 ms = 5.7 h)
--    Municipality OR community match, mirroring the previous
--    .or('city.ilike.X,city_region.ilike.X') — resolves to a BitmapOr across both
--    lower() indexes.
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
    AND s.close_price >= p_price_floor
    AND s.purchase_contract_date >= p_cutoff
  -- listing_key breaks ties on purchase_contract_date. Without it the LIMIT boundary
  -- is plan-dependent: ~19 rows can share the cut-off date, so the old ILIKE seq scan
  -- and this index scan would keep different subsets, and neither was reproducible
  -- run-to-run. §4 requires deterministic output; the PK gives a total order.
  ORDER BY s.purchase_contract_date DESC, s.listing_key DESC
  LIMIT p_limit
$$;

COMMENT ON FUNCTION public.sold_close_list_rows(text, numeric, date, integer) IS
  'Cohort close/list rows for a municipality OR community. Replaces the ILIKE .or() '
  'filter in src/lib/property/getCloseListRatio.ts so idx_vow_sold_city_lower_pcd / '
  '_cityregion_lower_pcd are usable. SECURITY INVOKER — service_role only.';

-- ---------------------------------------------------------------------------
-- 2. fetchSiblingModel  (was 43,023 calls @ 166 ms = 2.0 h)
--    The caller previously paged up to 20 x 1,000 rows purely to build a JS Set of
--    distinct city_region — up to 20 round-trips and 20,000 rows to produce ~30-50
--    values. DISTINCT here returns the same set in one call, and removes the
--    documented truncation risk at the 20-page guard (audit MEDIUM-9).
--    NULL/'' are excluded to match the caller's `if (r.city_region)` truthy filter.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sold_city_regions(
  p_city      text,
  p_sub_types text[]
)
RETURNS TABLE (city_region text)
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
  SELECT DISTINCT s.city_region::text
  FROM public.raw_vow_sold s
  WHERE lower(s.city) = lower(p_city)
    AND s.property_sub_type = ANY(p_sub_types)
    AND s.city_region IS NOT NULL
    AND s.city_region <> ''
  ORDER BY 1
$$;

COMMENT ON FUNCTION public.sold_city_regions(text, text[]) IS
  'Distinct communities within a municipality for the given sub-type spellings. '
  'Replaces the 20-page ILIKE paging loop in src/lib/avm/siblingModel.ts. '
  'SECURITY INVOKER — service_role only.';

-- ---------------------------------------------------------------------------
-- 3. fetchPeerAnchor rung 2  (was 52,676 calls @ 128 ms = 1.9 h)
--    Column list and order mirror COMP_SELECT in src/lib/avm/anchorService.ts:78-81
--    exactly. property_sub_type is matched with = ANY (not lowered) because
--    rawVariantsOf() supplies exact MLS spellings, including trailing spaces
--    ("Semi-Detached ") — lowering here would change matching behaviour.
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
    AND s.close_price >= p_price_floor
    AND s.purchase_contract_date >= p_cutoff
  -- See sold_close_list_rows: deterministic tie-break at the MAX_COMPS boundary.
  ORDER BY s.purchase_contract_date DESC, s.listing_key DESC
  LIMIT p_limit
$$;

COMMENT ON FUNCTION public.sold_city_comps(text, text[], numeric, date, integer) IS
  'City-wide peer comps (fetchPeerAnchor rung 2). Replaces the ILIKE city filter in '
  'src/lib/avm/anchorService.ts:674. SECURITY INVOKER — service_role only.';

-- ---------------------------------------------------------------------------
-- Grants: service_role only.
--
-- REVOKE ... FROM PUBLIC is NOT sufficient on Supabase: the project's ALTER DEFAULT
-- PRIVILEGES grants EXECUTE on new functions to anon and authenticated *directly*, so
-- those grants survive a PUBLIC revoke. They must be revoked by name.
--
-- These return row-level VOW sold data (per-transaction close_price / list_price), not
-- the aggregate shape the public region_* RPCs expose, so anon must never hold EXECUTE.
-- SECURITY INVOKER + RLS on raw_vow_sold would already return zero rows to anon today;
-- this makes that independent of any future policy change rather than reliant on it.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.sold_close_list_rows(text, numeric, date, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sold_city_regions(text, text[])                    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sold_city_comps(text, text[], numeric, date, integer) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.sold_close_list_rows(text, numeric, date, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.sold_city_regions(text, text[])                    TO service_role;
GRANT EXECUTE ON FUNCTION public.sold_city_comps(text, text[], numeric, date, integer) TO service_role;

INSERT INTO public.schema_migrations (filename, applied_via)
VALUES ('099_sold_city_lookup_rpcs.sql', 'apply')
ON CONFLICT DO NOTHING;
