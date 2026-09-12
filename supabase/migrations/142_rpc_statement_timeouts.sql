-- 142 — expose each RPC's statement_timeout so the canary can watch for a deleted one.
--
-- THE FAILURE THIS EXISTS FOR, twice now. `CREATE OR REPLACE FUNCTION` replaces the ENTIRE
-- declaration, `proconfig` included. Omit the `SET statement_timeout` line from the new body
-- and the budget is deleted: no error, no warning, and nothing in the migration diff that
-- reads as a removal — the line is simply absent, which looks the same as a line that was
-- never there.
--
--   * Migration 123 gave region_rental_yield `SET statement_timeout TO '60s'`. Migration 133
--     re-declared the body for the closed-lease basis pick and did not repeat it, so the
--     function silently fell back to the caller's budget. PostgREST logs in as
--     `authenticator` (statement_timeout = 8s), and Ottawa's rental yield needs ~4.3s alone
--     but 24.1s alongside its ten sibling slices in the nightly fan-out. Result: "Ottawa: no
--     rental yield rows" every night for 13 days, for a region whose rows were in the table.
--   * Migration 135 then took its base from the LIVE definition (pg_get_functiondef, the
--     mig-132 rule), which by then no longer carried the SET, and carried the omission
--     forward — which is how a deletion like this outlives the migration that caused it.
--
-- Neither was visible to any existing check. The data-health canary watches the OUTPUT of
-- these RPCs, so it reported the symptom (a null slice) three weeks running while the cause
-- sat one catalog column away, unread. This function is what makes that column readable.
--
-- WHY AN RPC AT ALL. PostgREST cannot select from `pg_proc`, so the canary — which talks to
-- Supabase over REST, not libpq — has no way to ask. One narrow, read-only, service-role
-- function is the whole mechanism.
--
-- WHAT IT RETURNS. One row per matching function: its name, its identity arguments (so an
-- overloaded name stays distinguishable — 115 names in this database are overloaded, all of
-- them PostGIS), and its statement_timeout as the RAW string Postgres stored ('60s', '90s',
-- '45000', …). Parsing is deliberately left to the caller: the units are a small grammar
-- worth unit-testing, and src/lib/data/rpcTimeouts.ts tests it. A function with no budget
-- returns NULL here, which is precisely the condition the canary treats as an error.
--
-- WHAT IT MATCHES. Everything named `region\_%` — so a NEW region RPC is covered the day it
-- lands, with no list to remember to update — plus any extra names the caller passes in
-- `p_names`. The extra names live in TypeScript (EXPECTED_RPC_TIMEOUT_MS) and are passed as a
-- parameter, following the same rule as count_unpriceable_valued_estimates in migration 113:
-- the SQL holds no second copy of a list that can drift from the canonical one.
--
-- 755 functions live in `public` (PostGIS is most of them), so the filter is not cosmetic.
--
-- Rollback: DROP FUNCTION public.rpc_statement_timeouts(text[]);

CREATE OR REPLACE FUNCTION public.rpc_statement_timeouts(p_names text[] DEFAULT NULL::text[])
RETURNS TABLE(function_name text, identity_args text, statement_timeout text)
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
  SELECT p.proname::text,
         pg_get_function_identity_arguments(p.oid)::text,
         -- proconfig is a text[] of 'name=value' entries, or NULL when the function declares
         -- no SET at all. NULL here means "inherits the caller's budget" — the bug.
         (SELECT split_part(cfg, '=', 2)
            FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) AS cfg
           WHERE cfg LIKE 'statement\_timeout=%'
           LIMIT 1)
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.prokind = 'f'                       -- functions only; no procedures or aggregates
     AND (
          p.proname LIKE 'region\_%'
       OR (p_names IS NOT NULL AND p.proname = ANY (p_names))
     )
$$;

COMMENT ON FUNCTION public.rpc_statement_timeouts(text[]) IS
  'Data-health canary input: each watched RPC''s statement_timeout as stored in proconfig, '
  'NULL when it declares none. Exists because CREATE OR REPLACE FUNCTION silently deletes a '
  'SET clause the new body omits — it removed region_rental_yield''s 60s budget in migration '
  '133 and cost 13 nights of null Ottawa rental yield (migration 142). Matches region_% plus '
  'any names passed in p_names; the canonical extra list is EXPECTED_RPC_TIMEOUT_MS in '
  'src/lib/data/rpcTimeouts.ts. Read-only, SECURITY INVOKER, service_role only.';

REVOKE ALL ON FUNCTION public.rpc_statement_timeouts(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_statement_timeouts(text[]) TO service_role;

-- Verify — 12 rows today, none with a NULL statement_timeout:
--   SELECT * FROM rpc_statement_timeouts(
--     ARRAY['count_unpriceable_valued_estimates','city_trend_coverage']
--   ) ORDER BY function_name;
--
-- And the shape of the bug this watches for, if you want to see it fire:
--   ALTER FUNCTION public.region_rental_yield(text, text[]) RESET statement_timeout;  -- don't
