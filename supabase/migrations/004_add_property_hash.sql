-- ============================================================================
-- Shadow MLS - Phase 4: Add property_hash column for Entity Resolution
-- ============================================================================
-- 
-- This migration adds the property_hash column to enable entity resolution
-- across historical listing chains. The SHA-256 hash links relisted properties
-- to their previous campaigns, allowing True DOM calculation.
--
-- IMPORTANT: Index created for high-speed ETL lookups at scale
-- ============================================================================

-- Add property_hash column (VARCHAR for SHA-256 hex = 64 chars)
ALTER TABLE listings 
ADD COLUMN IF NOT EXISTS property_hash VARCHAR(64);

-- Create index for efficient property_hash lookups
-- Critical for ETL worker batch processing (1 query, group locally pattern)
CREATE INDEX IF NOT EXISTS idx_listings_property_hash 
ON listings(property_hash);

-- Optional: Index on (property_hash, listing_key) for exact matches
CREATE INDEX IF NOT EXISTS idx_listings_property_hash_listing_key 
ON listings(property_hash, listing_key);

-- Index on listing_key for quick current listing lookups
CREATE INDEX IF NOT EXISTS idx_listings_listing_key 
ON listings(listing_key);

COMMENT ON COLUMN listings.property_hash IS 
  'SHA-256 hash of normalized address (UnitNumber|StreetNumber|StreetName|City).
   Used for Entity Resolution to link historical listing chains and calculate True DOM.';