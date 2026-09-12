-- 143 — count_unpriceable_valued_estimates: stop re-running the pattern subquery 114,161 times.
--
-- Migration 126 measured this scan at 23.3s cold / 6.1s warm and gave the function a 45s
-- budget, closing with: "If this timeout ever proves too tight, the index is the next step —
-- not a bigger timeout." It has proved too tight. On 2026-09-12 the canary reported
--
--     unpriceable-value count unavailable (canceling statement due to statement timeout)
--
-- which is 57014 against the function's OWN 45s, not the client abort that #522 fixed — the
-- client wall simply had to move before the server wall became visible. `listings` is now
-- 4,235 MB / 324,041 rows, against the ~3.9 GB of two weeks ago, and the canary is the one
-- caller that always runs cold. Measured today: 17-22s warm, 42.6s under EXPLAIN ANALYZE.
--
-- It turns out the next step is neither an index nor a bigger timeout. It is the predicate.
--
-- WHERE THE TIME WENT. The subtype test was an EXISTS over unnest(p_patterns), which the
-- planner compiles to a correlated SubPlan — re-executed once per candidate row. It also
-- makes the whole disjunction opaque, so the planner drove from property_estimates and
-- probed a 4.2 GB heap once per row:
--
--     Nested Loop  (actual time=42564.401..42564.401 rows=0)
--       ->  Seq Scan on property_estimates e                      (rows=115,336)
--       ->  Index Scan using listings_listing_key_key on listings (loops=115,336)
--             Filter: ... OR EXISTS(SubPlan 1)
--             SubPlan 1
--               ->  Function Scan on unnest p                     (loops=114,161)   <-- 16 LIKEs, 114k times
--     Buffers: shared hit=388757 read=74405
--     Execution Time: 42564.592 ms
--
-- THE FIX. `LIKE ANY (array)` is a ScalarArrayOpExpr, not a subquery: the array of patterns
-- is built ONCE as an InitPlan and the comparison is evaluated inline. That also leaves the
-- disjunction transparent enough for the planner to filter `listings` directly and hash-join,
-- instead of driving from the estimates side:
--
--     Parallel Hash Join  (actual time=1764.376..1764.378 rows=0)
--       InitPlan 1 -> Function Scan on unnest p  (rows=16, loops=1)                 <-- once
--       ->  Parallel Seq Scan on property_estimates e
--       ->  Parallel Hash -> Parallel Seq Scan on listings l
--             Filter: ... OR (lower(btrim(property_sub_type)) ~~ ANY ((InitPlan 1).col1))
--     Buffers: shared hit=8728 read=46797
--     Execution Time: 1787.050 ms          -- 24x faster, 8.4x less buffer traffic
--
-- Plain (uninstrumented) runs: 1.3s and 1.7s, against 17.2s and 22.1s for the old body.
--
-- EQUIVALENCE, verified read-only against prod before writing this — count=0 on both sides
-- proves nothing when the correct answer IS zero, so the two predicates were compared over
-- the whole table where the answer is large:
--
--     old_n = 42,325   new_n = 42,325   only_old = 0   only_new = 0   total = 324,041
--
-- and per distinct subtype (41 of them, NULL included): 0 disagreements. The 18 subtypes both
-- forms flag are vacant land, commercial retail, office, sale of business, industrial,
-- multiplex, land, farm, triplex, investment, mobiletrailer, rural residential,
-- store w apt/office, fourplex, vacant land condo, parking space, locker, commercial.
--
-- WHY NOT AN INDEX. Migration 126's own reasoning still holds and now needs no exception: an
-- index on `listings` costs write amplification on every nightly sync, permanently, to speed
-- up one query that runs once a day. At 1.8s the query no longer needs one.
--
-- The `SET search_path` and `SET statement_timeout` clauses below are load-bearing and are
-- repeated DELIBERATELY. CREATE OR REPLACE FUNCTION replaces proconfig wholesale, so omitting
-- them here would delete both — the exact silent deletion that cost region_rental_yield its
-- 60s budget in migration 133 and 13 nights of null Ottawa rental yield. Migration 142's
-- `rpc-timeouts` canary now watches for that, and this function is one of the names it
-- watches. 45s is kept unchanged: it is now ~25x the measured cost, and lowering it is a
-- separate decision that would have to be made in EXPECTED_RPC_TIMEOUT_MS too.
--
-- Rollback: re-apply migration 126.

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
      -- Built once as an InitPlan. The EXISTS form this replaces was a per-row SubPlan.
      OR lower(btrim(l.property_sub_type)) LIKE ANY (
           ARRAY(SELECT '%' || p || '%' FROM unnest(p_patterns) AS p)
         )
    )
$$;

COMMENT ON FUNCTION public.count_unpriceable_valued_estimates(text[], text[], text[]) IS
  'Data-health canary: ACTIVE unpriceable-type listings carrying an AVM value (must be '
  '0). All predicate lists are parameters — the canonical copies live in '
  'src/lib/avm/normalizeType.ts. SECURITY INVOKER — service_role only. Carries a '
  'function-local statement_timeout of 45s (migration 126). Migration 143 replaced the '
  'per-row EXISTS pattern test with LIKE ANY over an InitPlan array: 42.6s to 1.8s, '
  'row-for-row identical (42,325 matches either way, symmetric difference 0).';

REVOKE ALL ON FUNCTION public.count_unpriceable_valued_estimates(text[], text[], text[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.count_unpriceable_valued_estimates(text[], text[], text[])
  TO service_role;

-- Verify — must return 0, in under ~2s, and proconfig must still carry BOTH SET clauses:
--   SELECT count_unpriceable_valued_estimates(
--     ARRAY['land'],
--     ARRAY['vacant','farm','rural resid','mobile','trailer','parking','locker',
--           'sale of business','triplex','fourplex','multiplex','office','retail',
--           'industrial','investment','commercial'],
--     ARRAY['sold','closed','closed sale','leased','terminated','expired','suspended']);
--   SELECT proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname='public' AND p.proname='count_unpriceable_valued_estimates';
