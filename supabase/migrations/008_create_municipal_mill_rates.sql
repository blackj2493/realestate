-- Migration 008: Create municipal_mill_rates table
-- Purpose: Baseline mill rates by city for tax burden anomaly detection
-- Used to calculate assessment_status by comparing actual tax to expected tax

CREATE TABLE IF NOT EXISTS municipal_mill_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  city TEXT NOT NULL UNIQUE,
  base_mill_rate NUMERIC(6, 4) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Drop existing trigger if exists and recreate
DROP TRIGGER IF EXISTS update_municipal_mill_rates_updated_at ON municipal_mill_rates;
CREATE TRIGGER update_municipal_mill_rates_updated_at
  BEFORE UPDATE ON municipal_mill_rates
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Seed initial data (Ontario major metros - mill rate per dollar of assessed value)
INSERT INTO municipal_mill_rates (city, base_mill_rate) VALUES
  ('Toronto', 0.0070),
  ('Brampton', 0.0100),
  ('Mississauga', 0.0095),
  ('Oakville', 0.0088),
  ('Burlington', 0.0085),
  ('Hamilton', 0.0092),
  ('London', 0.0115),
  ('Kitchener', 0.0112),
  ('Waterloo', 0.0110),
  ('Cambridge', 0.0112),
  ('Guelph', 0.0105),
  ('Ottawa', 0.0080),
  ('Barrie', 0.0110),
  ('Vaughan', 0.0090),
  ('Richmond Hill', 0.0088),
  ('Markham', 0.0092),
  ('Newmarket', 0.0095),
  ('Whitby', 0.0102),
  ('Oshawa', 0.0108),
  ('Ajax', 0.0105),
  ('Pickering', 0.0105)
ON CONFLICT (city) DO NOTHING;