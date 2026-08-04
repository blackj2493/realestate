-- Migration 108: partial indexes over the EMPTY-MEDIA candidate set on `listings`.
--
-- Why: the nightly media reconciliation (Query A2, reconcileMissingMedia) has never
-- recovered a single active listing in production. Its candidate query
--
--     SELECT listing_key, full_payload FROM listings
--      WHERE (media_urls IS NULL OR media_urls = '{}')
--        AND created_at >= <cutoff>
--        AND listing_key > <cursor>
--      ORDER BY listing_key LIMIT 100
--
-- has no index that covers the empty-media predicate, so it degenerates into a scan
-- that also DETOASTS full_payload for every candidate it touches. That sits right on
-- the edge of the statement timeout and tips over on a bad night — two consecutive
-- nightly runs, same code:
--
--   2026-08-03 (job 91609249666)  ⚠️  canceling statement due to statement timeout
--                                 🩹 Scanned 0 recent empty-media listings, recovered 0
--   2026-08-04 (job 91903179184)  ℹ️  Hit the 1000-row reconciliation cap
--                                 🩹 Scanned 1000 recent empty-media listings, recovered 999
--
-- The failure is swallowed as non-fatal (correct — media must never fail the sync), so a
-- lost night is indistinguishable from a clean one: "Scanned 0 … recovered 0" reads as
-- "nothing needed recovering". The 999/1000 recovery rate on the night it DID run shows
-- the backlog is recoverable inventory, so every lost night is real listings left blank.
--
-- The companion code change stops selecting full_payload during the scan (keys first,
-- payloads hydrated per page by primary key); these indexes make the remaining
-- predicate sargable so the query stops flirting with the timeout at all.
--
-- Predicate note: it is spelled EXACTLY as PostgREST renders `.or('media_urls.is.null,
-- media_urls.eq.{}')` — `media_urls IS NULL OR media_urls = '{}'::text[]`. The planner
-- matches a partial index by proving the query's WHERE implies the index predicate, and
-- it cannot prove that from an equivalent-but-differently-spelled form such as
-- `cardinality(media_urls) = 0`. Keep the two in sync if the query ever changes.
--
-- Two indexes, one per sweep:
--   * _key     — backlog sweep: keyset-paginates the whole empty set by listing_key.
--   * _created — recent sweep: range-scans the 21-day window, then sorts the (small)
--                match set by listing_key.
--
-- Build cost: the predicate touches only `media_urls` (a plain text[] column) — it does
-- NOT detoast full_payload, so this is unlike the migration-020 partial indexes that
-- exceeded the SQL editor's gateway timeout (CLAUDE.md §12). On ~112k rows it builds in
-- seconds. Plain CREATE INDEX (not CONCURRENTLY) because applyMigrationFiles.ts sends
-- the file as one multi-statement query, which pg runs in an implicit transaction —
-- CONCURRENTLY is illegal there. It takes a brief ACCESS EXCLUSIVE lock, so apply it
-- outside the nightly sync window (03:00–07:00 UTC).
--
-- Run: npx tsx scripts/admin/applyMigrationFiles.ts 108_listings_empty_media_indexes.sql

CREATE INDEX IF NOT EXISTS idx_listings_empty_media_key
  ON listings (listing_key)
  WHERE media_urls IS NULL OR media_urls = '{}'::text[];

CREATE INDEX IF NOT EXISTS idx_listings_empty_media_created
  ON listings (created_at, listing_key)
  WHERE media_urls IS NULL OR media_urls = '{}'::text[];

COMMENT ON INDEX idx_listings_empty_media_key IS
  'Query A2 backlog sweep (migration 108): keyset pagination over listings with no photos. Predicate is spelled to match PostgREST''s rendering of .or(media_urls.is.null,media_urls.eq.{}) so the planner can prove implication.';
COMMENT ON INDEX idx_listings_empty_media_created IS
  'Query A2 recent sweep (migration 108): created_at range scan over listings with no photos. Same predicate spelling as idx_listings_empty_media_key.';
