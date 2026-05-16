-- Migration 006: Create rental_market_index table
-- Purpose: Rolling 90-day average rent estimates by CityRegion + PropertySubType + BedroomsTotal
-- Used by the Rent AVM engine for annual_rent_estimate and p10_rent_estimate

CREATE TABLE IF NOT EXISTS rental_market_index (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  city_region TEXT NOT NULL,
  property_sub_type TEXT NOT NULL,
  bedrooms_total INTEGER NOT NULL,
  washrooms_full INTEGER DEFAULT 0,
  avg_rent NUMERIC(12, 2) NOT NULL,
  p10_rent NUMERIC(12, 2) NOT NULL,
  sample_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(city_region, property_sub_type, bedrooms_total, washrooms_full)
);

CREATE INDEX IF NOT EXISTS idx_rental_market_lookup 
  ON rental_market_index(city_region, property_sub_type, bedrooms_total);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Drop existing trigger if exists and recreate
DROP TRIGGER IF EXISTS update_rental_market_index_updated_at ON rental_market_index;
CREATE TRIGGER update_rental_market_index_updated_at
  BEFORE UPDATE ON rental_market_index
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();