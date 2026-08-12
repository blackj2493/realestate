-- 112_sold_fsa_comps.sql
--
-- WHY: the TRREB feed ships NO CityRegion for whole municipalities — all of Waterloo
-- Region (Kitchener, Cambridge, Waterloo, Woolwich, Wilmot, North Dumfries, Wellesley)
-- and Brantford, 4,155 active listings. The AVM keys every comp lookup on city_region,
-- so mapListingToAVMInput returns null and NO estimate is ever attempted: measured
-- 0 of 4,155 have a value. The sold side carries the identical blank field
-- (Kitchener: 4,080 of 4,080 sold rows), so the community rung finds nothing either.
--
-- The comps themselves are all there — Kitchener alone has 2,433 sales in the last
-- 365 days, every one with a close price and a postal code. What is missing is a
-- geographic key both sides share.
--
-- POSTAL FSA IS THAT KEY. It is 100% populated on both sides (2,433/2,433 sold,
-- 5,379/5,379 active) and it is a genuinely NEIGHBOURHOOD-scale unit, not a
-- municipality-scale one: Kitchener's 18 FSAs carry 50-347 sales each in 12 months
-- (N2E: 347, of which 202 detached). That is a denser cohort than many Toronto
-- CityRegion communities that price fine today.
--
-- The distinction matters for the BAND, not just for coverage. predSD is
-- sqrt(estVar + scale^2) where `scale` is the irreducible spread of the comp pool and
-- does NOT shrink as comps are added (anchorService.ts:334). Anchoring these listings
-- on a city-wide pool would mix every neighbourhood into `scale` and produce a wide,
-- LOW-confidence band even at nEff 45-65 — an estimate we publish but cannot stand
-- behind. An FSA pool keeps `scale` at neighbourhood scale, which is the whole point.
--
-- No new columns and no data migration: raw_vow_sold stays READ-ONLY (CLAUDE.md §12).
--
-- SECURITY: SECURITY INVOKER (the default) + STABLE, exactly as migration 099.
-- raw_vow_sold has RLS ENABLED with no policies, so SECURITY DEFINER would bypass RLS
-- and expose VOW sold data to anon/authenticated — a compliance breach. EXECUTE is
-- granted to service_role only; the caller (fetchAnchor) uses the service-role client.

-- ---------------------------------------------------------------------------
-- 1. Index: FSA + contract date.
--
-- Expression must match the RPC's predicate EXACTLY or the planner ignores it.
-- btrim guards a leading space; the FSA is the first 3 characters either way
-- ("N2H 5X8" and "N2H5X8" both yield N2H). upper/left/btrim are all IMMUTABLE,
-- which an expression index requires.
--
-- PARTIAL on transaction_type: every caller filters For Sale (the feed stamps some
-- Lease campaigns with a Sold status — trust transaction_type, not status), so the
-- predicate is always satisfiable and the index stays materially smaller.
-- ---------------------------------------------------------------------------
-- NOT written CONCURRENTLY, deliberately. applyMigrationFiles.ts sends each file as one
-- multi-statement query, which Postgres runs in an implicit transaction block, and
-- CREATE INDEX CONCURRENTLY is rejected there. Keeping the plain form is what makes this
-- file replayable through the standard tooling.
--
-- On prod this statement is already a no-op: the index was built CONCURRENTLY out of band
-- (0.7s, 4.7 MB, indisvalid=true) so the hottest table in the database never took a write
-- lock. Anyone replaying from empty gets the same index with a lock measured in seconds.
CREATE INDEX IF NOT EXISTS idx_vow_sold_fsa_pcd
  ON public.raw_vow_sold (upper(left(btrim(postal_code), 3)), purchase_contract_date DESC)
  WHERE transaction_type = 'For Sale';

COMMENT ON INDEX public.idx_vow_sold_fsa_pcd IS
  'Postal-FSA comp lookup for listings whose feed carries no CityRegion (Waterloo '
  'Region, Brantford). Expression mirrors sold_fsa_comps exactly; partial on '
  'transaction_type=For Sale, which every caller filters.';

-- ---------------------------------------------------------------------------
-- 2. sold_fsa_comps — the FSA analogue of sold_city_comps (migration 099).
--
-- Returns COMP_SELECT's columns in COMP_SELECT's order (src/lib/avm/anchorService.ts:79)
-- so the row maps onto CompRow positionally, same as sold_city_comps.
--
-- p_city is a REQUIRED co-filter, not decoration. Urban FSAs sit inside one
-- municipality so it is a no-op there, but rural FSAs (N0B) span several townships;
-- without it a Woolwich subject could anchor on comps two municipalities away. The
-- FSA predicate drives the index; the city equality then filters a small set and can
-- use idx_vow_sold_city_lower_pcd if the planner prefers it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sold_fsa_comps(
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
  'CityRegion. Called by fetchAnchor when cityRegionLookupCandidates is empty. '
  'SECURITY INVOKER — service_role only.';

-- ---------------------------------------------------------------------------
-- 3. Grants. REVOKE FROM PUBLIC alone is NOT sufficient on Supabase: the project's
--    ALTER DEFAULT PRIVILEGES grants EXECUTE to anon/authenticated directly, so both
--    roles must be named explicitly (same reasoning as migration 099).
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.sold_fsa_comps(text, text, text[], numeric, date, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sold_fsa_comps(text, text, text[], numeric, date, integer)
  TO service_role;
