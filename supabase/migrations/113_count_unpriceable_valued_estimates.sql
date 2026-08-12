-- 113_count_unpriceable_valued_estimates.sql
--
-- Canary RPC for the stale-estimate class (data-health check 'unpriceable-values').
--
-- WHY: refresh-property-estimates.ts used to SKIP listings whose recompute produced
-- nothing (no estimate AND no GLA), which preserved whatever the table already held.
-- A listing that once had a value and later became unpriceable — tuning change,
-- subtype correction — kept its stale number forever: measured 2026-08-12, 1,346
-- active land/commercial listings carried dwelling-model values frozen in May, and
-- since PR #319 wired estimates into Deal Score those values were grading vacant
-- land. The script now clears such rows; this RPC lets the nightly canary alert if
-- the invariant is ever violated again, by ANY writer.
--
-- The invariant: an ACTIVE listing of a type the AVM refuses to price
-- (isUnpriceableType, normalizeType.ts) must never carry estimated_value > 0.
--
-- EVERY predicate list arrives as a parameter — exact-match subtypes, substring
-- patterns, terminal statuses — so this function holds NO copy of any of them.
-- normalizeType.ts exports UNPRICEABLE_EXACT / UNPRICEABLE_PATTERNS precisely so the
-- canary can pass the canonical values; a list duplicated here would re-create the
-- exact drift this whole fix removes.
--
-- COST: one hash join, property_estimates(value>0, ~94k narrow rows) × listings flat
-- columns (no TOAST). ~1-3s once daily, inside the 8s PostgREST budget.
--
-- SECURITY: SECURITY INVOKER + STABLE, EXECUTE to service_role only — same reasoning
-- as migrations 099/112 (RLS is enabled with no policies on these tables; DEFINER
-- would bypass it, and the canary runs with the service-role client anyway).

CREATE OR REPLACE FUNCTION public.count_unpriceable_valued_estimates(
  p_exact    text[],
  p_patterns text[],
  p_terminal text[]
)
RETURNS integer
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
  SELECT count(*)::int
  FROM public.property_estimates e
  JOIN public.listings l ON l.listing_key = e.listing_key
  WHERE e.estimated_value > 0
    AND l.list_price >= 50000
    AND l.standard_status IS NOT NULL
    AND l.standard_status <> ALL (p_terminal)
    AND (
      lower(btrim(l.property_sub_type)) = ANY (p_exact)
      OR EXISTS (
        SELECT 1 FROM unnest(p_patterns) AS p
        WHERE lower(btrim(l.property_sub_type)) LIKE '%' || p || '%'
      )
    )
$$;

COMMENT ON FUNCTION public.count_unpriceable_valued_estimates(text[], text[], text[]) IS
  'Data-health canary: ACTIVE unpriceable-type listings carrying an AVM value (must be '
  '0). All predicate lists are parameters — the canonical copies live in '
  'src/lib/avm/normalizeType.ts. SECURITY INVOKER — service_role only.';

REVOKE ALL ON FUNCTION public.count_unpriceable_valued_estimates(text[], text[], text[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.count_unpriceable_valued_estimates(text[], text[], text[])
  TO service_role;
