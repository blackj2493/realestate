-- Shadow MLS - Listings Table Migration
-- 
-- This migration creates the primary listings storage table.
-- Full JSON payload stored for complete detail retrieval.
-- Derived metrics pre-computed for fast persona filtering.
--
-- Run: supabase db push (or apply via Supabase dashboard)
--

-- ============================================================================
-- Create listings table
-- ============================================================================

CREATE TABLE IF NOT EXISTS listings (
  -- Primary key (internal UUID)
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Maps to the real estate board's ListingKey (external identifier)
  -- Unique constraint ensures no duplicates from different syncs
  listing_key VARCHAR(100) UNIQUE NOT NULL,
  
  -- Full payload: Complete raw API response
  -- JSONB for fast JSON operations and indexing on nested fields
  -- Contains ALL fields from ProptX API including media arrays, room dimensions, remarks
  full_payload JSONB NOT NULL,
  
  -- Extracted media URLs for quick CDN access
  -- Array of strings for fast filtering without parsing JSON
  media_urls TEXT[] DEFAULT '{}',
  
  -- Pre-computed persona metrics for fast filtering
  -- These are computed by the ETL worker during ingestion
  derived_metrics JSONB DEFAULT '{
    "isDistressed": false,
    "targetGrossYield": null,
    "hasSecondarySuitePotential": false,
    "calculatedDOM": null
  }',
  
  -- Coordinate resolution flag
  -- TRUE if postal code lookup AND API coordinates both failed
  -- ETL workers can batch-correct these with external geocoding
  needs_geocoding BOOLEAN DEFAULT false,
  
  -- Denormalized fields for fast queries (avoid JSON parsing in hot paths)
  city VARCHAR(100),
  property_sub_type VARCHAR(50),
  list_price BIGINT,  -- Stored as integer cents to avoid floating point issues
  
  -- Timestamps for sync tracking
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  synced_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- Indexes for common query patterns
-- ============================================================================

-- Sync tracking: find listings needing re-sync
CREATE INDEX idx_listings_synced_at ON listings(synced_at ASC);

-- Geocoding flag: batch correct unmapped listings
CREATE INDEX idx_listings_needs_geocoding ON listings(needs_geocoding) WHERE needs_geocoding = true;

-- City browsing (most common filter)
CREATE INDEX idx_listings_city ON listings(city);

-- Property type browsing
CREATE INDEX idx_listings_property_sub_type ON listings(property_sub_type);

-- Price range filtering (hot path for search)
CREATE INDEX idx_listings_price ON listings(list_price);

-- Composite index for common search patterns
CREATE INDEX idx_listings_city_price ON listings(city, list_price);

-- Full-text search on address (uses GIN for JSONB)
-- Allows fast search within full_payload without extracting fields
CREATE INDEX idx_listings_full_payload_gin ON listings USING GIN (full_payload jsonb_path_ops);

-- ============================================================================
-- Triggers for updated_at timestamp
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_listings_updated_at
  BEFORE UPDATE ON listings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Comments for documentation
-- ============================================================================

COMMENT ON TABLE listings IS 'Shadow MLS - Primary listing storage with full API payload';
COMMENT ON COLUMN listings.listing_key IS 'Real estate board ListingKey (external ID)';
COMMENT ON COLUMN listings.full_payload IS 'Complete raw API response - all fields including media arrays';
COMMENT ON COLUMN listings.media_urls IS 'Extracted image URLs for CDN serving';
COMMENT ON COLUMN listings.derived_metrics IS 'Pre-computed persona filters: isDistressed, targetGrossYield, hasSecondarySuitePotential, calculatedDOM';
COMMENT ON COLUMN listings.needs_geocoding IS 'TRUE when both postal code lookup AND API coordinates failed - requires manual correction';
COMMENT ON COLUMN listings.city IS 'Denormalized for fast city-based filtering';
COMMENT ON COLUMN listings.property_sub_type IS 'Denormalized for fast property type filtering';
COMMENT ON COLUMN listings.list_price IS 'Denormalized as integer cents to avoid floating point comparison issues';

-- ============================================================================
-- Row Level Security (RLS)
-- ============================================================================

-- Enable RLS for security
ALTER TABLE listings ENABLE ROW LEVEL SECURITY;

-- Public read for all authenticated users (search results)
-- Note: We control what goes IN via ETL, so reads can be public for search
CREATE POLICY "Public read for authenticated users" ON listings
  FOR SELECT
  TO authenticated
  USING (true);

-- Service role (ETL worker) has full access
-- This is enforced via SUPABASE_SERVICE_ROLE_KEY in the backend client

-- ============================================================================
-- Grant permissions
-- ============================================================================

-- Grant read to authenticated role
GRANT SELECT ON listings TO authenticated;

-- Grant full access to service role (ETL workers)
GRANT ALL ON listings TO service_role;