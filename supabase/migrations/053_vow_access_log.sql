-- Migration 053: VOW consumer-access audit trail (PROPTX VOW Datafeed Agreement §5.4)
--
-- §5.4 requires the Member to maintain an audit trail of Consumers' activity on the VOW
-- and make it available to PROPTX on demand. This is a DELIBERATELY MINIMAL trail: it
-- records only WHO (auth user) accessed WHICH VOW resource (a listing key) and WHEN — no
-- VOW numbers, no page content, no IP. Minimal fields keep the privacy surface small
-- (the log itself is Personal Information under PIPEDA; see privacy policy §"VOW access log").
--
-- Written server-side (service role) at the consumer VOW gate (src/lib/audit/vowAccessLog.ts).
-- Pruned to a short retention window by scripts/worker/pruneVowAccessLog.ts (default 12 months).
--
-- Apply manually (no supabase CLI linked): paste into the Supabase SQL editor, or
--   psql "$DATABASE_URL" -f supabase/migrations/053_vow_access_log.sql

CREATE TABLE IF NOT EXISTS public.vow_access_log (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  resource    TEXT NOT NULL,            -- e.g. 'listing:W1234567'
  accessed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Prune-by-time and produce-per-consumer lookups.
CREATE INDEX IF NOT EXISTS vow_access_log_accessed_at_idx ON public.vow_access_log (accessed_at);
CREATE INDEX IF NOT EXISTS vow_access_log_user_id_idx ON public.vow_access_log (user_id);

-- RLS ON with NO policies → only the service role (server-side app/admin, which bypasses
-- RLS) can read or write. Consumers cannot read anyone's access history — not even their
-- own — through the API. Aligns with migration 049 (RLS on all public tables). ON DELETE
-- CASCADE means a consumer's rows vanish when their auth account is deleted (PIPEDA).
ALTER TABLE public.vow_access_log ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.vow_access_log IS
  'VOW §5.4 consumer-activity audit trail. Append-only; minimal fields (user + resource + time); short retention; service-role only.';
