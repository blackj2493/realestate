-- Migration 007: Create city_region_avg_price table
-- Purpose: Historical average sale prices by city region
-- Used to defeat the $1 bidding war listing edge case when calculating Cap Rate and Tax Burden
-- Also used for calculation_price when ListPrice < $200K + Detached/SemiDetached

CREATE TABLE IF NOT EXISTS city_region_avg_price (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  city_region TEXT NOT NULL UNIQUE,
  avg_sale_price NUMERIC(14, 2) NOT NULL,
  property_sub_type TEXT DEFAULT 'Detached',
  sample_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_city_region_price 
  ON city_region_avg_price(city_region);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Drop existing trigger if exists and recreate
DROP TRIGGER IF EXISTS update_city_region_avg_price_updated_at ON city_region_avg_price;
CREATE TRIGGER update_city_region_avg_price_updated_at
  BEFORE UPDATE ON city_region_avg_price
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Seed initial data for Ontario major metros
INSERT INTO city_region_avg_price (city_region, avg_sale_price, property_sub_type, sample_count) VALUES
  ('Toronto', 1100000, 'Detached', 0),
  ('Brampton', 950000, 'Detached', 0),
  ('Mississauga', 1050000, 'Detached', 0),
  ('Oakville', 1400000, 'Detached', 0),
  ('Burlington', 1200000, 'Detached', 0),
  ('Hamilton', 850000, 'Detached', 0),
  ('London', 650000, 'Detached', 0),
  ('Kitchener', 720000, 'Detached', 0),
  ('Waterloo', 780000, 'Detached', 0),
  ('Cambridge', 700000, 'Detached', 0),
  ('Guelph', 780000, 'Detached', 0),
  ('Ottawa', 650000, 'Detached', 0),
  ('Barrie', 750000, 'Detached', 0),
  ('Markham', 1300000, 'Detached', 0),
  ('Richmond Hill', 1450000, 'Detached', 0),
  ('Vaughan', 1350000, 'Detached', 0),
  ('Newmarket', 950000, 'Detached', 0),
  ('Whitby', 880000, 'Detached', 0),
  ('Oshawa', 750000, 'Detached', 0),
  ('Ajax', 850000, 'Detached', 0),
  ('Pickering', 900000, 'Detached', 0)
ON CONFLICT (city_region) DO NOTHING;