-- ============================================================================
-- Shadow MLS - Phase 5: Add Carry Cost & Suite Analysis Columns
-- ============================================================================
-- 
-- This migration adds columns for:
-- - True Carry Cost breakdown (monthly mortgage, tax, HOA, insurance, utilities, capex)
-- - Suite Analysis (status, score, flags)
-- - Enhanced derived metrics
--
-- Run: supabase db push (or apply via Supabase dashboard)
-- ============================================================================

-- Add carry cost breakdown columns
ALTER TABLE listings 
ADD COLUMN IF NOT EXISTS carry_cost JSONB DEFAULT '{
  "monthlyMortgage": 0,
  "monthlyPropertyTax": 0,
  "monthlyHOA": 0,
  "monthlyInsurance": 0,
  "monthlyUtilities": 0,
  "monthlyCapEx": 0,
  "trueCarryCost": 0
}'::jsonb;

-- Add suite analysis columns
ALTER TABLE listings 
ADD COLUMN IF NOT EXISTS suite_status VARCHAR(20) DEFAULT 'NONE',
ADD COLUMN IF NOT EXISTS suite_score INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS suite_flags TEXT[] DEFAULT '{}';

-- Add true DOM result (enhanced from property_hash alone)
ALTER TABLE listings 
ADD COLUMN IF NOT EXISTS true_dom INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS is_stale BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS campaign_block_id VARCHAR(100),
ADD COLUMN IF NOT EXISTS dead_days INTEGER DEFAULT 0;

-- Add individual carry cost components for fast filtering
ALTER TABLE listings 
ADD COLUMN IF NOT EXISTS monthly_carry_cost DECIMAL(12,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS monthly_mortgage DECIMAL(12,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS monthly_property_tax DECIMAL(12,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS monthly_hoa DECIMAL(12,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS monthly_insurance DECIMAL(12,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS monthly_capex DECIMAL(12,2) DEFAULT 0;

-- Add index on monthly_carry_cost for fast filtering (Smart Homebuyer persona)
CREATE INDEX IF NOT EXISTS idx_listings_monthly_carry_cost 
ON listings(monthly_carry_cost);

-- Add index on suite_status for suite-based filtering
CREATE INDEX IF NOT EXISTS idx_listings_suite_status 
ON listings(suite_status);

-- Add index on true_dom for stale inventory detection
CREATE INDEX IF NOT EXISTS idx_listings_true_dom 
ON listings(true_dom);

COMMENT ON COLUMN listings.carry_cost IS 
  'True carry cost breakdown: monthlyMortgage, monthlyPropertyTax, monthlyHOA, monthlyInsurance, monthlyUtilities, monthlyCapEx, trueCarryCost';

COMMENT ON COLUMN listings.suite_status IS 
  'Secondary suite status: NONE, POTENTIAL_CANDIDATE, EXISTING_SUITE';

COMMENT ON COLUMN listings.suite_score IS 
  'Suite potential score (0-6 points): basement full height +2, separate entrance +2, basement bath +1, rooms below >=2 +1, parking >=2 +1';

COMMENT ON COLUMN listings.suite_flags IS 
  'Array of flags explaining suite analysis: basement type, entrance type, bathroom rough-in, etc.';

COMMENT ON COLUMN listings.true_dom IS 
  'True Days on Market - cumulative days including relists within same campaign block';

COMMENT ON COLUMN listings.is_stale IS 
  'True if true_dom > 90 days - stale inventory indicator';

COMMENT ON COLUMN listings.campaign_block_id IS 
  'Campaign block identifier - groups relisted properties within 45 days';

COMMENT ON COLUMN listings.dead_days IS 
  'Days DOM exceeded reasonable listing period (true_dom - 30)';

COMMENT ON COLUMN listings.monthly_carry_cost IS 
  'Total monthly carry cost (mortgage + tax + HOA + insurance + utilities + capex)';

COMMENT ON COLUMN listings.monthly_mortgage IS 
  'Monthly mortgage payment (Canadian semi-annual compounding, 20% down, 4.04% 5-year fixed)';

COMMENT ON COLUMN listings.monthly_property_tax IS 
  'Monthly property tax (actual or municipal mill rate estimate)';

COMMENT ON COLUMN listings.monthly_hoa IS 
  'Monthly HOA/condo fee (0 for freehold)';

COMMENT ON COLUMN listings.monthly_insurance IS 
  'Monthly insurance ($40 condo, $135 freehold, $200 multi-family)';

COMMENT ON COLUMN listings.monthly_capex IS 
  'Monthly CapEx reserve (1% rule: 1% list price/year for freehold, 0.5% for condo)';