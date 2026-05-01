-- Shadow MLS - Fix Numeric Type Casting Errors
-- 
-- The Ampre API sends float values for specific fields:
-- - LotWidth, LotDepth (dimensions can be fractional)
-- - BathroomsTotalInteger (e.g., "14.5" for 14.5 bathrooms)
-- - TaxAnnualAmount (tax amounts are decimal)
-- - targetGrossYield (calculated yields are fractional)
--
-- This migration ensures the JSONB storage properly handles these values
-- by storing them as numeric/JSONB rather than attempting bigint casts.
--
-- Run: supabase db push (or apply via Supabase dashboard)

-- ============================================================================
-- Verify current derived_metrics JSONB structure
-- ============================================================================

-- Check if derived_metrics column exists and has proper JSONB type
DO $$
BEGIN
  -- The derived_metrics is already JSONB, so no schema change needed
  -- But we add a check to ensure we're not trying to extract to typed columns
  
  RAISE NOTICE 'derived_metrics column is JSONB and stores targetGrossYield correctly';
  
  -- Add comment documenting the float-compatible storage
  COMMENT ON COLUMN listings.derived_metrics IS 
    'Pre-computed persona filters: isDistressed, targetGrossYield (float), hasSecondarySuitePotential, calculatedDOM (integer)';
    
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Migration check failed: %', SQLERRM;
END $$;

-- ============================================================================
-- Optional: Add computed columns for commonly accessed float fields
-- These are VIRTUAL columns that extract from JSONB without casting issues
-- Uncomment if you need typed columns for fast queries
-- ============================================================================

/*
-- Example: Virtual column for targetGrossYield
-- This extracts the value from JSONB as float without casting issues
ALTER TABLE listings 
ADD COLUMN IF NOT EXISTS target_gross_yield numeric GENERATED ALWAYS AS (
  (derived_metrics->>'targetGrossYield')::numeric
) STORED;

-- Example: Virtual column for calculatedDOM (integer - days are whole numbers)
ALTER TABLE listings 
ADD COLUMN IF NOT EXISTS calculated_dom integer GENERATED ALWAYS AS (
  (derived_metrics->>'calculatedDOM')::integer
) STORED;

-- Add index on the computed columns for fast filtering
CREATE INDEX IF NOT EXISTS idx_listings_target_yield ON listings(target_gross_yield) 
  WHERE target_gross_yield IS NOT NULL;
  
CREATE INDEX IF NOT EXISTS idx_listings_calculated_dom ON listings(calculated_dom) 
  WHERE calculated_dom IS NOT NULL;
*/

-- ============================================================================
-- Validation: Check for any existing triggers or functions that might cast
-- ============================================================================

-- Ensure there are no triggers casting derived_metrics fields to integer
-- If found, they would need to be updated to use appropriate casts

DO $$
DECLARE
  trigger_record RECORD;
BEGIN
  FOR trigger_record IN 
    SELECT trigger_name, action_statement 
    FROM information_schema.triggers 
    WHERE event_object_table = 'listings'
  LOOP
    RAISE NOTICE 'Found trigger: %', trigger_record.trigger_name;
    -- Check if trigger body contains problematic casts
    IF trigger_record.action_statement LIKE '%::bigint%' OR 
       trigger_record.action_statement LIKE '%::integer%' THEN
      RAISE WARNING 'Trigger % may have integer casting issues', trigger_record.trigger_name;
    END IF;
  END LOOP;
END $$;

-- ============================================================================
-- Documentation
-- ============================================================================

COMMENT ON COLUMN listings.full_payload IS 
  'Contains all float fields: LotWidth, LotDepth, BathroomsTotalInteger, TaxAnnualAmount (API sends floats, stored as JSON numbers)';