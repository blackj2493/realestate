-- NNN: <one line — what this migration adds>.
--
-- WHY. <the problem it solves, with the numbers that justify it>.
--
-- Who reads and writes it: <service role only | signed-in users via RLS | public>.
--
-- Safe to re-run.
--
-- Copy this file to supabase/migrations/NNN_<name>.sql. It lives outside that folder so no
-- tool ever applies it.

CREATE TABLE IF NOT EXISTS public.example_table (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     uuid        REFERENCES auth.users (id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.example_table ENABLE ROW LEVEL SECURITY;

-- ── Data API grants (REQUIRED since 2026-10-30) ─────────────────────────────────────────
-- Supabase no longer grants new public tables to the API roles. Without these lines every
-- supabase-js call — the service role's included — returns "permission denied", and our
-- server code often logs that and moves on. src/lib/supabase/migrationGrants.test.ts fails
-- CI when a new migration creates a public table or view without the service_role grant.
--
-- service_role: always (workers, API routes, admin scripts that use supabase-js).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.example_table TO service_role;
--
-- authenticated / anon: ONLY when the browser reads this table directly, and only together
-- with an RLS policy that limits the rows. With RLS on and no policy, a grant alone exposes
-- nothing, but grant the least the page needs.
-- GRANT SELECT ON public.example_table TO authenticated;
-- CREATE POLICY "own rows" ON public.example_table FOR SELECT TO authenticated
--   USING (user_id = auth.uid());
--
-- Use an IDENTITY column, not serial: a serial column also needs
-- GRANT USAGE ON SEQUENCE public.example_table_id_seq TO <role>.
--
-- A table only ever reached over a raw pg connection may opt out of the check instead:
-- -- no-api-grant: public.example_table — <reason>

COMMENT ON TABLE public.example_table IS
  '<what it holds>. <who writes it>. See <the code that owns it>.';

INSERT INTO schema_migrations (filename, applied_via)
VALUES ('NNN_<name>.sql', 'sql-editor')
ON CONFLICT (filename) DO NOTHING;
