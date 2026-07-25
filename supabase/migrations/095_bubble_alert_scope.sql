-- 095: market_bubbles.alert_scope — per-bubble choice of what the nightly
-- new-listing digest matches (owner decision 2026-07-24).
--
--   'all'      (default) — every new listing in the area above the worker's
--              price floor: today's behaviour, unchanged for EVERY existing row
--              (deliberate: bubbles saved before this feature carry filter
--              snapshots the user never chose as alert rules — retroactively
--              enforcing them would silently mute alerts).
--   'filtered' — the worker additionally applies the bubble's saved filter
--              snapshot (universal filters + persona clause, translated via the
--              SAME buildTerminalCoreClauses the terminal search uses — see
--              src/lib/alerts/bubbleFilterClause.ts) and the email labels the
--              active filters.
--
-- Additive; no backfill needed. Rollback: ALTER TABLE market_bubbles DROP COLUMN alert_scope.

ALTER TABLE market_bubbles
  ADD COLUMN IF NOT EXISTS alert_scope text NOT NULL DEFAULT 'all'
  CHECK (alert_scope IN ('all', 'filtered'));

COMMENT ON COLUMN market_bubbles.alert_scope IS
  'Nightly digest match scope: ''all'' = every new listing in the area (default); ''filtered'' = apply the bubble''s saved filter snapshot (worker translates via buildTerminalCoreClauses).';
