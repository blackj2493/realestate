-- ============================================================================
-- Shadow MLS - Manual Migration Instructions
-- ============================================================================
-- 
-- EXECUTE THIS SQL IN SUPABASE DASHBOARD SQL EDITITOR
-- URL: https://supabase.com/dashboard/project/pyzgnivilxhnwzfrdkiq/sql
--
-- The Supabase connection pooler (pgBouncer) does NOT support CONCURRENTLY.
-- You must use the direct PostgreSQL connection via SQL Editor.
-- ============================================================================

-- Step 1: Commit any pending transaction (REQUIRED for CONCURRENTLY)
COMMIT;

-- Step 2: Drop existing index if present
DROP INDEX IF EXISTS public.idx_listings_property_hash;

-- Step 3: Recreate index with CONCURRENTLY (non-blocking, zero-downtime)
CREATE INDEX CONCURRENTLY idx_listings_property_hash 
ON public.listings USING btree (property_hash);

-- Step 4: Verify creation
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'listings' 
    AND indexname = 'idx_listings_property_hash'
    AND indexdef LIKE '%btree%'
  ) THEN
    RAISE NOTICE '✅ Index idx_listings_property_hash created (B-Tree)';
  ELSE
    RAISE WARNING '⚠️  Index creation may have failed';
  END IF;
END $$;

-- Step 5: Refresh table statistics for query planner
ANALYZE public.listings;

-- Verification query (run separately)
-- SELECT indexname, pg_size_pretty(pg_relation_size(indexrelid)) 
-- FROM pg_stat_user_indexes 
-- WHERE relname = 'listings' AND indexname LIKE 'idx_listings_%';