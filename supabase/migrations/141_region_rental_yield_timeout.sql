-- 141 — region_rental_yield: put back the 60s statement_timeout that migration 133 dropped.
--
-- THE BUG. Migration 123 declared this function with a function-local budget:
--
--     CREATE OR REPLACE FUNCTION public.region_rental_yield(...)
--      LANGUAGE sql
--      STABLE
--      SET statement_timeout TO '60s'          -- 123
--
-- Migration 133 re-declared the body to add the closed-lease basis pick and did NOT repeat
-- that line. `CREATE OR REPLACE FUNCTION` replaces the ENTIRE declaration, `proconfig`
-- included, so the 60s budget was deleted in silence — no error, no warning, nothing in the
-- diff to read as a removal. Migration 135 then took its base from the LIVE definition
-- (pg_get_functiondef, per the mig-132 rule), which by then no longer carried the SET, and
-- carried the omission forward. Measured on prod 2026-09-12:
--
--     proname                    proconfig
--     region_active_aggregates   {statement_timeout=90s}
--     region_dom_distribution    {statement_timeout=90s}
--     region_price_cuts          {statement_timeout=90s}
--     region_listing_outcomes    {statement_timeout=60s}
--     region_sold_dynamics       {statement_timeout=60s}
--     region_rental_yield        NULL          <-- the only one
--
-- WHAT IT COSTS. With no function-local SET the call inherits the caller's budget, and
-- PostgREST runs as `authenticator` — statement_timeout = 8s. Ottawa's rental yield needs
-- ~4.3s warm and serial, which passes, and ~8s+ the moment it shares the database with its
-- 10 sibling slices in the nightly region_metrics fan-out, which does not. Reproduced
-- read-only against prod on 2026-09-12, the six slices called exactly as the precompute
-- calls them:
--
--     serial     rental   4.3s  ok rows=5
--     parallel   rental   8.2s  ERROR 57014 canceling statement due to statement timeout
--
-- computeRentalYield throws on error, Promise.allSettled turns that into `rental: null`, the
-- upsert writes the null over the good row, and the data-health canary reports
-- "Ottawa: no rental yield rows" — for a region whose rows are sitting in the table. It has
-- done so every night since 133 landed on 2026-08-30.
--
-- Note that migration 135 was a REAL fix for a REAL problem (a full-table sort before the
-- region filter) and it worked: 9.3s became 4.3s. It just could not hold, because the
-- headroom it was buying had already been deleted underneath it.
--
-- THE FIX. Restore the budget. ALTER FUNCTION ... SET touches `proconfig` ONLY — the body,
-- the signature, the grants and the plan all stay exactly as migration 135 left them. 60s
-- matches what 123 chose and what region_sold_dynamics and region_listing_outcomes still
-- carry.
--
-- Rollback: ALTER FUNCTION public.region_rental_yield(text, text[]) RESET statement_timeout;

-- Fail rather than "succeed" against a renamed or re-signed function: a silent no-op here is
-- the same class of failure this migration exists to undo.
DO $guard$
BEGIN
  IF to_regprocedure('public.region_rental_yield(text, text[])') IS NULL THEN
    RAISE EXCEPTION 'public.region_rental_yield(text, text[]) does not exist — apply migrations 123/133/135 first';
  END IF;
END
$guard$;

ALTER FUNCTION public.region_rental_yield(text, text[]) SET statement_timeout = '60s';

-- Verify (expects {statement_timeout=60s}):
--   SELECT p.proname, p.proconfig
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.proname = 'region_rental_yield';
--
-- And the behaviour it restores — this must return 5 rows, not 57014:
--   SELECT * FROM region_rental_yield('Ottawa', NULL);
