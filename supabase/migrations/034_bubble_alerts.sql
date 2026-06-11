-- 034_bubble_alerts.sql
-- Per-bubble new-listing alert state (spec: docs/superpowers/specs/2026-06-10-granular-alerts-design.md).
-- alerts_enabled: default ON (user decision 2026-06-10); per-bubble mute toggle in the dashboard.
-- notify_since:   watermark. NULL = not yet baselined; the worker's first sight of a bubble sets it
--                 to the run timestamp and emails nothing (no backlog dumps).
-- Instant DDL — safe for the Supabase SQL editor (no table rewrite: plain ADD COLUMN with
-- non-volatile defaults).

ALTER TABLE public.market_bubbles
  ADD COLUMN IF NOT EXISTS alerts_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS notify_since   TIMESTAMPTZ;

COMMENT ON COLUMN public.market_bubbles.alerts_enabled IS
  'Nightly new-listing digest opt-out for this bubble (default ON).';
COMMENT ON COLUMN public.market_bubbles.notify_since IS
  'New-listing alert watermark (EntryTimestamp cutoff). NULL = not yet baselined by the worker.';
