-- Migration: 011_avm_path_a.sql
-- Path A: replace the SHAP-importance matrix with an interpretable standardized
-- log-linear model. avm_multiplier_matrix now stores, per feature, the Beta
-- (log-price semi-elasticity per 1 standard deviation), plus the training Mean
-- and StdDev used to standardize the live feature at request time.
-- avm_audit_report gains base_price (trimmed-mean close price) as a fallback
-- anchor when there are no recent comps.
--
-- These are app-owned, fully regenerable tables. This migration is idempotent.
-- It does NOT touch raw_vow_sold.

ALTER TABLE avm_multiplier_matrix DROP COLUMN IF EXISTS dollar_per_unit;
ALTER TABLE avm_multiplier_matrix DROP COLUMN IF EXISTS multiplier;
ALTER TABLE avm_multiplier_matrix ADD COLUMN IF NOT EXISTS beta      FLOAT NOT NULL DEFAULT 0;
ALTER TABLE avm_multiplier_matrix ADD COLUMN IF NOT EXISTS feat_mean FLOAT NOT NULL DEFAULT 0;
ALTER TABLE avm_multiplier_matrix ADD COLUMN IF NOT EXISTS feat_std  FLOAT NOT NULL DEFAULT 1;

ALTER TABLE avm_audit_report ADD COLUMN IF NOT EXISTS base_price FLOAT;
