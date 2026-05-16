-- Migration: 006_avm_tables.sql
-- Phase 1: AVM Schema — Anchor & Adjust tables

-- ─────────────────────────────────────────────
-- TABLE 1: AVM Audit Report
-- Matches 00_Master_Audit_Report.csv column names
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS avm_audit_report (
  id                    SERIAL PRIMARY KEY,
  city_region           VARCHAR(100) NOT NULL,
  property_sub_type     VARCHAR(100) NOT NULL,
  total_sales_analyzed  INTEGER NOT NULL DEFAULT 0,
  model_accuracy_score  FLOAT NOT NULL DEFAULT 0,  -- The R² score
  average_error_margin  FLOAT NOT NULL DEFAULT 0,  -- The MAE
  created_at            TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at            TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (city_region, property_sub_type)
);

CREATE INDEX IF NOT EXISTS idx_avm_audit_region_type
  ON avm_audit_report (city_region, property_sub_type);

COMMENT ON TABLE avm_audit_report IS
  'Model accuracy metrics per market and property type for gating decision';

-- ─────────────────────────────────────────────
-- TABLE 2: AVM Multiplier Matrices
-- Per-unit coefficient multipliers for each feature
-- Matches the CSV structure: feature_name, multiplier
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS avm_multiplier_matrix (
  id                SERIAL PRIMARY KEY,
  city_region       VARCHAR(100) NOT NULL,
  property_sub_type VARCHAR(100) NOT NULL,
  feature_name      VARCHAR(50) NOT NULL,
  -- feature_name values: bedrooms_above_grade, bathrooms_total_integer,
  -- parking_total, interior_score, exterior_score, basement_score
  dollar_per_unit   BIGINT NOT NULL,   -- Dollar amount per unit (stored as integer cents)
  multiplier        FLOAT NOT NULL,    -- Per-unit decimal, e.g., 0.0161 means +1.61% per unit
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (city_region, property_sub_type, feature_name)
);

CREATE INDEX IF NOT EXISTS idx_avm_matrix_region_type
  ON avm_multiplier_matrix (city_region, property_sub_type);

COMMENT ON TABLE avm_multiplier_matrix IS
  'Per-unit coefficient multipliers exported from the offline model';