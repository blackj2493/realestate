-- Shadow MLS - Flipper & Deal Hunter Persona Metrics (Phase 1)
-- 
-- This migration adds flipper-specific metrics for identifying and analyzing
-- distressed properties, price drops, and deal-hunting opportunities.
--
-- Run: supabase db push (or apply via Supabase dashboard)

-- ============================================================================
-- SECTION 1: Properties Table - Add Flipper Columns
-- ============================================================================

ALTER TABLE properties ADD COLUMN IF NOT EXISTS distress_score SMALLINT DEFAULT 0;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS deal_type_flag VARCHAR(50) DEFAULT 'STANDARD';
ALTER TABLE properties ADD COLUMN IF NOT EXISTS max_holding_cost INTEGER;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS target_price INTEGER;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS true_price_drop_pct DECIMAL(5,1) DEFAULT 0;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS price_drop_velocity DECIMAL(5,1) DEFAULT 0;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS capital_discount INTEGER DEFAULT 0;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS peak_price INTEGER;

-- ============================================================================
-- SECTION 2: New Tables
-- ============================================================================

-- ETL Error Log - for corrupted payload tracking
CREATE TABLE IF NOT EXISTS etl_error_log (
    id SERIAL PRIMARY KEY,
    ml_number VARCHAR(20),
    raw_payload JSONB,
    error_message TEXT,
    error_stack TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Price History Cache - tracks price history for deal analysis
CREATE TABLE IF NOT EXISTS price_history_cache (
    id SERIAL PRIMARY KEY,
    pid VARCHAR(50) NOT NULL,
    ml_number VARCHAR(20) NOT NULL,
    list_price INTEGER NOT NULL,
    listed_date DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Regional Price Cache - avg price by subtype and city
CREATE TABLE IF NOT EXISTS regional_price_cache (
    id SERIAL PRIMARY KEY,
    property_subtype VARCHAR(50) NOT NULL,
    city VARCHAR(100) NOT NULL,
    avg_price INTEGER,
    sample_count INTEGER DEFAULT 0,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(property_subtype, city)
);

-- True DOM Cache - calculated true days on market per listing
CREATE TABLE IF NOT EXISTS true_dom_cache (
    id SERIAL PRIMARY KEY,
    ml_number VARCHAR(20) NOT NULL UNIQUE,
    true_dom INTEGER DEFAULT 0,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- System Config - key-value store for flipper configuration
CREATE TABLE IF NOT EXISTS system_config (
    id SERIAL PRIMARY KEY,
    config_key VARCHAR(100) NOT NULL UNIQUE,
    config_value TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================================
-- SECTION 3: Indexes
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_properties_deal_type_flag ON properties(deal_type_flag);
CREATE INDEX IF NOT EXISTS idx_properties_distress_score ON properties(distress_score);
CREATE INDEX IF NOT EXISTS idx_properties_max_holding_cost ON properties(max_holding_cost);
CREATE INDEX IF NOT EXISTS idx_properties_true_price_drop_pct ON properties(true_price_drop_pct);

-- ============================================================================
-- SECTION 4: Default Config Values
-- ============================================================================

INSERT INTO system_config (config_key, config_value, description)
VALUES ('alternative_investor_rate', '0.0799', 'Alternative investor mortgage rate (7.99%) for flipper carry cost calculations')
ON CONFLICT (config_key) DO NOTHING;

-- ============================================================================
-- SECTION 5: Comments
-- ============================================================================

COMMENT ON COLUMN properties.distress_score IS 
    'Flipper distress score (0-100): 0=none, 50+=legal distress, 75+=fixer upper, 90+=motivated seller';

COMMENT ON COLUMN properties.deal_type_flag IS 
    'Deal classification: STANDARD, LEGAL_DISTRESS, FIXER_UPPER, MOTIVATED_SELLER, ASSIGNMENT_SALE';

COMMENT ON COLUMN properties.max_holding_cost IS 
    'Maximum estimated holding cost (mortgage + taxes + insurance + HOA) for flip analysis';

COMMENT ON COLUMN properties.target_price IS 
    'Flipper target purchase price based on repair estimates and market analysis';

COMMENT ON COLUMN properties.true_price_drop_pct IS 
    'True price drop percentage from peak listing price (e.g., 15.5 for 15.5% drop)';

COMMENT ON COLUMN properties.price_drop_velocity IS 
    'Rate of price reduction ($/day) - faster drops indicate motivated sellers';

COMMENT ON COLUMN properties.capital_discount IS 
    'Dollar discount from last listed price to target price';

COMMENT ON COLUMN properties.peak_price IS 
    'Highest listed price in the current listing chain';