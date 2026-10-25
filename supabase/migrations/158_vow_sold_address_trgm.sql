-- 158_vow_sold_address_trgm.sql
--
-- A trigram index on raw_vow_sold.unparsed_address, so an address ILIKE reads the
-- index and not the whole table.
--
-- WHY. Supabase warned on 2026-10-24 that the project was draining its Disk IO budget.
-- pg_stat_statements (since 2026-07-28) put ~85% of all disk reads on ONE query: the
-- street ledger on every listing and address page (src/lib/address/streetLedger.ts),
--     unparsed_address ILIKE '%<street token>%'
-- 357k calls, 8.9 TB read from disk, ~1.1 s each. A leading-wildcard ILIKE cannot use a
-- btree, so every call scanned the full heap (~34k buffers) and detoasted raw_payload for
-- every match. The detoast half is fixed in the same PR (the opt-out flags moved to a
-- second primary-key query). This index fixes the scan half, and it also serves the
-- anchored address probes in saleRecord.ts, soldByKey.ts ('<number>%<token>%').
--
-- WRITE COST. raw_vow_sold takes ~3k upserts a day; a GIN index on one short text column
-- adds little to that, and fastupdate keeps the inserts cheap.
--
-- APPLY. CREATE INDEX CONCURRENTLY cannot run inside a transaction block, and the
-- Supabase SQL Editor wraps a multi-statement script in one. Run the two statements
-- SEPARATELY: the CREATE EXTENSION first, then the CREATE INDEX on its own.

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vow_sold_address_trgm
  ON public.raw_vow_sold USING gin (unparsed_address extensions.gin_trgm_ops);
