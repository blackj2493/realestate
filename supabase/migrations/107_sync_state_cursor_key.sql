-- Migration 107: cursor_key on sync_state — a RESUMABLE keyset cursor for sweeps
-- that walk `listings` by listing_key rather than by ModificationTimestamp.
--
-- Why: the nightly media reconciliation (Query A2, scripts/worker/ingester.ts
-- reconcileMissingMedia) keyset-paginates the empty-media set ordered by
-- listing_key, but its cursor was a LOCAL variable seeded to '' on every run and
-- the pass is capped at MEDIA_RECONCILE_MAX rows. Whenever the empty-media set
-- exceeded that cap, every night re-scanned the SAME alphabetically-first slice
-- and never advanced — so key prefixes that sort late were never reached at all.
-- TRREB prefixes order C < E < N < S < W < X, which starved X- (Hamilton,
-- Niagara, Waterloo, London — everything outside the GTA) hardest: those
-- listings kept a blank gallery indefinitely while the feed had their photos.
--
-- last_sync_timestamp cannot carry this: it is TIMESTAMPTZ and already means
-- "delta cursor" for the master/sold/delisted rows. A separate nullable TEXT
-- column keeps the two cursor kinds from colliding, and lets a sweep row store a
-- listing_key while leaving last_sync_timestamp free for its own delta bookkeeping.
--
-- ADD COLUMN nullable = instant, no table rewrite (sync_state holds a handful of
-- rows regardless). NULL means "start from the beginning", which is exactly the
-- pre-migration behaviour, so this is safe to apply before the code ships.
--
-- Run: npx tsx scripts/admin/applyMigrationFiles.ts 107_sync_state_cursor_key.sql

ALTER TABLE sync_state ADD COLUMN IF NOT EXISTS cursor_key TEXT;

COMMENT ON COLUMN sync_state.cursor_key IS
  'Resumable keyset cursor (a listings.listing_key) for sweeps that paginate by key instead of by ModificationTimestamp — currently the media reconciliation rows (id=''media_reconcile_recent'' / ''media_reconcile_backlog''). NULL/empty = start from the beginning; the sweep wraps back to NULL once it walks off the end.';
