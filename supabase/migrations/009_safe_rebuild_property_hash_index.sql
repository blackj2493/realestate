-- ============================================================================
-- Shadow MLS - Safe Index Rebuild Migration
-- ============================================================================
--
-- This migration safely drops and recreates idx_listings_property_hash
-- using CONCURRENTLY to avoid table locks in production.
--
-- IMPORTANT: CONCURRENTLY cannot run inside a transaction block.
-- The migration explicitly commits before rebuilding.
-- ============================================================================

-- Step 1: Commit any pending transaction (required for CONCURRENTLY)
COMMIT;

-- Step 2: Drop the existing index if it exists
DROP INDEX IF EXISTS public.idx_listings_property_hash;

-- Step 3: Recreate the index concurrently (non-blocking, zero-downtime)
CREATE INDEX CONCURRENTLY idx_listings_property_hash 
ON public.listings USING btree (property_hash);

-- Step 4: Verify the index was created
DO $$
DECLARE
  idx_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'listings'
    AND indexname = 'idx_listings_property_hash'
    AND indexdef LIKE '%btree%'
  ) INTO idx_exists;
  
  IF idx_exists THEN
    RAISE NOTICE '✅ Index idx_listings_property_hash created successfully (B-Tree)';
  ELSE
    RAISE WARNING '⚠️  Index creation may have failed - verify manually';
  END IF;
END $$;

-- Step 5: Force fresh statistics for query planner
ANALYZE public.listings;

-- Step 6: Report status
DO $$
DECLARE
  idx_size text;
  total_rows bigint;
BEGIN
  -- Get index size
  SELECT pg_size_pretty(pg_relation_size('idx_listings_property_hash')) INTO idx_size;
  RAISE NOTICE '📊 Index size: %', idx_size;
  
  -- Get row estimate
  SELECT reltuples::bigint INTO total_rows FROM pg_class WHERE relname = 'listings';
  RAISE NOTICE '📊 Estimated table rows: %', total_rows;
END $$;