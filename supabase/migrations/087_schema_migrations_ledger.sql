-- 087 — schema_migrations ledger.
--
-- WHY: migrations here are applied MANUALLY (scripts/admin/applyMigrationFiles.ts) and
-- nothing recorded that they had run. "Which migrations are actually live?" was therefore
-- unanswerable, which is exactly how migration 082 sat UNAPPLIED for days while /analytics
-- and the dashboard served stale numbers — it failed silently rather than erroring, so
-- nobody had a reason to look.
--
-- This ledger makes the applied set explicit. applyMigrationFiles.ts records every file it
-- applies, and the nightly data-health canary diffs supabase/migrations/*.sql against this
-- table and alerts on anything unapplied.
--
-- Baselining: the ledger starts empty while migrations 001–086 are demonstrably already
-- live. Run `npx tsx scripts/admin/applyMigrationFiles.ts --baseline` ONCE to record every
-- current migration file as applied WITHOUT executing it, then the diff is meaningful.

CREATE TABLE IF NOT EXISTS schema_migrations (
  filename    text PRIMARY KEY,
  applied_at  timestamptz NOT NULL DEFAULT now(),
  -- 'baseline' for files recorded retroactively, 'apply' for a real run.
  applied_via text NOT NULL DEFAULT 'apply',
  -- Wall-clock duration of the apply, when known.
  duration_ms integer
);

COMMENT ON TABLE schema_migrations IS
  'Ledger of applied migration files. Written by scripts/admin/applyMigrationFiles.ts; diffed against supabase/migrations/*.sql by the nightly data-health canary so an unapplied migration is caught instead of silently serving stale data (cf. migration 082).';
