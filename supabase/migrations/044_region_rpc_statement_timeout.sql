-- Migration 044: raise statement_timeout on the two region-aggregate RPCs.
--
-- BUG (found by end-to-end verification of the dashboard filters): hitting
-- /api/market/region-stats for "Toronto" with ANY filter (beds/baths/parking/
-- frontage/basement) returns HTTP 500 — Postgres log: "canceling statement due to
-- statement timeout". region_active_aggregates reads beds/baths/parking/frontage
-- from the heavily-TOASTed listings.full_payload jsonb; once migration 042 rolled
-- Toronto's 35 district codes up into one "Toronto" market, a filtered query
-- detoasts full_payload across ~14k matched rows and takes ~17s (measured), which
-- exceeds the role's default statement_timeout → the statement is cancelled.
--
-- FIX: pin a generous statement_timeout on BOTH region RPCs so the (rare, cold)
-- slow query completes and populates the 24h unstable_cache instead of 500ing.
-- The app runs as a long-running server on Railway (not serverless), so there is
-- no competing short request/function timeout — a 17s cold call is fine and only
-- the first distinct (region, scope) per day pays it; every later hit is cached.
--
-- A function-scoped `SET statement_timeout` overrides the caller's (lower) value for
-- the duration of the function body — the standard Supabase remedy for slow RPCs.
-- Pure GUC attachment: no body change, no table touch, instant + idempotent.
--
-- NOTE (durable perf follow-up, NOT done here): the real cost is the full_payload
-- detoast. Denormalising beds/baths/parking/lot_width/basement into flat columns on
-- `listings` (as the sold side already does on raw_vow_sold) would drop the query to
-- sub-second. That needs an ETL change (transformer.ts/sync.ts) + a ~136k-row
-- backfill, so it is intentionally separate from this hotfix.
--
-- Run: npx tsx scripts/admin/applyMigration044.ts   (or paste into the SQL editor)

ALTER FUNCTION region_active_aggregates(text, text[], integer, numeric, integer, numeric, text)
  SET statement_timeout = '60s';

ALTER FUNCTION region_price_trend(text, text[], integer, numeric, integer, numeric, integer, text)
  SET statement_timeout = '60s';
