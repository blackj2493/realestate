-- 126_unpriceable_canary_timeout.sql
--
-- Fixes the data-health canary check `unpriceable-values`, which failed nightly
-- with "canceling statement due to statement timeout" from at least 2026-08-23.
--
-- MEASURED on prod 2026-08-29 (EXPLAIN ANALYZE, BUFFERS):
--   cold 23.3s   warm 6.1s   PostgREST role budget 8s   count = 0
-- The invariant HOLDS. This was a speed fault in the check, never a data fault.
--
-- WHERE THE TIME GOES: the planner drives from property_estimates (102,748 rows
-- with estimated_value > 0) and probes listings once per row on listing_key.
-- listings is 3,918 MB, so those probes cost shared hit=370,469 read=40,523 —
-- ~316 MB of RANDOM heap I/O. The canary runs once a day, so the cache is always
-- cold and it always pays the full 23s.
--
-- WHY A TIMEOUT AND NOT AN INDEX: a covering index on listings(listing_key)
-- INCLUDE (property_sub_type, standard_status, list_price) would only pay off via
-- an index-only scan, and that needs a current visibility map. The nightly sync
-- rewrites most of listings, so the map is stale exactly when the canary runs.
-- The index would also add write cost to every sync, permanently, to speed up one
-- query that runs ONCE a day and returns 0. A 23s read once daily is cheaper.
-- If this timeout ever proves too tight, the index is the next step — not a
-- bigger timeout.
--
-- The body below is BYTE-IDENTICAL to migration 113. The only change is the
-- function-local SET, which applies for the duration of this call and reverts on
-- exit. It cannot affect any other query or any other session.
--
-- NOTE: a function carrying a SET clause is never inlined by the planner. That is
-- intended here — inlining would discard the SET.

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
SET statement_timeout = '45s'
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
  'src/lib/avm/normalizeType.ts. SECURITY INVOKER — service_role only. Carries a '
  'function-local statement_timeout of 45s (migration 126): the scan costs ~23s cold '
  'against a 3.9 GB listings table and the role budget is 8s.';

REVOKE ALL ON FUNCTION public.count_unpriceable_valued_estimates(text[], text[], text[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.count_unpriceable_valued_estimates(text[], text[], text[])
  TO service_role;
