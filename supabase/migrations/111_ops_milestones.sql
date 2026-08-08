-- Migration 111: ops_milestones — "tell me once" ledger for threshold alerts
-- Purpose: A scheduled job that emails when a number crosses a line needs to
-- remember that it already did, or it emails on every run forever. One row per
-- milestone, written the moment the alert goes out.
--
-- Deliberately generic (key TEXT, not a founding-seat column): the next threshold
-- worth an email — signups per week, a cohort going stale, disk headroom — should
-- reuse this rather than grow another one-off table.
--
-- Idempotency is the PRIMARY KEY: the notifier does INSERT ... ON CONFLICT DO
-- NOTHING and only sends when the insert actually created a row. That makes the
-- "have I already told them?" check and the "record that I told them" write the
-- same atomic operation, so two overlapping cron runs can't double-send.
--
-- NEW TABLE ONLY. Does NOT touch raw_vow_sold / listings / sync_state (CLAUDE.md §12).
-- RLS on with NO policies (service-role writes only), per 014_terminal_applications.
--
-- Apply: npx tsx scripts/admin/applyMigrationFiles.ts 111_ops_milestones.sql

CREATE TABLE IF NOT EXISTS public.ops_milestones (
  key         TEXT PRIMARY KEY,
  -- The observed value at the moment we alerted (e.g. 181 when the line was 180),
  -- so the ledger records what actually happened rather than just the threshold.
  value       BIGINT,
  notified_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.ops_milestones ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.ops_milestones IS
  'One row per already-announced threshold. INSERT ... ON CONFLICT DO NOTHING is the '
  'idempotency guard for scheduled alert jobs: send the email only when the insert '
  'created the row. RLS on with no policies (service-role only).';
COMMENT ON COLUMN public.ops_milestones.key IS
  'Stable milestone id, e.g. founding_seats:180. Never reuse a key for a new meaning.';
COMMENT ON COLUMN public.ops_milestones.value IS
  'Observed value when the alert fired — may exceed the threshold if a run was missed.';
