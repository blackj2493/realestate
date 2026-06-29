-- supabase/migrations/049_enable_rls_all_public_tables.sql
--
-- SECURITY FIX — Supabase advisor `rls_disabled_in_public` (Critical).
-- "Anyone with the project URL can read/edit/delete all data in this table
--  because Row-Level Security is not enabled."
--
-- Root cause: several public tables were created without RLS. Some predate the
-- "RLS-enabled, no policies, service-role-only" convention established in
-- migration 035 (raw_vow_delisted); others (e.g. raw_vow_sold, the ~217k-row VOW
-- archive) were created outside the migrations directory and are therefore not
-- covered by any RLS-enabling migration at all.
--
-- WHY DENY-ALL (no policies) IS THE CORRECT FIX HERE
--   The frontend is architecturally blind to Supabase for property data: the
--   Command Center reads Typesense exclusively, and every server-side data read
--   goes through getServiceRoleClient() (src/lib/supabase/client.ts), which holds
--   the BYPASSRLS service_role and is unaffected by RLS. The only anon/SSR
--   (RLS-enforced) reads in the app touch profiles, watchlist,
--   underwriting_scenarios and market_bubbles — all of which already have RLS +
--   owner-scoped policies. So enabling RLS with NO policies on the remaining
--   tables blocks anonymous/public access (the vulnerability) without breaking a
--   single code path. This is the same posture as migration 035 §raw_vow_delisted.
--
--   VOW/IDX board data in particular MUST NEVER be anon-readable (TRREB licensing,
--   CLAUDE.md §4) — deny-all is also the compliant default.
--
-- SAFETY
--   ENABLE ROW LEVEL SECURITY is a catalog-only metadata change: it does NOT
--   rewrite the table, alter any column, or touch the data. It is therefore safe
--   even for raw_vow_sold (CLAUDE.md §12 forbids altering its *schema* / columns;
--   this changes neither) and instant on large tables — editor-safe.
--
-- IDEMPOTENT
--   The sweep only targets tables whose RLS flag is currently false, so re-running
--   is a no-op. Already-protected tables (listings, profiles, watchlist, etc.)
--   keep their existing policies untouched.
--
-- Run: npx tsx scripts/admin/applyMigration049.ts
--      (or paste this file into the Supabase SQL editor — instant DDL, no rewrite)

DO $$
DECLARE
  r RECORD;
  n_enabled int := 0;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public'
      AND c.relkind IN ('r', 'p')        -- ordinary + partitioned tables (not views/matviews)
      AND c.relrowsecurity = false       -- RLS not yet enabled
      AND c.relname <> 'spatial_ref_sys' -- PostGIS extension table — not ours to alter
    ORDER BY c.relname
  LOOP
    BEGIN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', r.relname);
      n_enabled := n_enabled + 1;
      RAISE NOTICE 'RLS enabled (deny-all, service-role-only): public.%', r.relname;
    EXCEPTION
      WHEN insufficient_privilege OR wrong_object_type THEN
        -- e.g. extension-owned tables we don't own; leave them and report.
        RAISE NOTICE 'Skipped public.% (cannot alter: %)', r.relname, SQLERRM;
    END;
  END LOOP;

  RAISE NOTICE 'Migration 049 complete — RLS enabled on % public table(s).', n_enabled;
END $$;
