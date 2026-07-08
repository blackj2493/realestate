-- 055_avm_staging.sql
-- Champion/challenger staging tables for the AVM retrain loop.
--
-- The AVM coefficient matrices (avm_multiplier_matrix + avm_audit_report) are the CHAMPION —
-- what production serves. A scheduled trainer writes a freshly-fit CHALLENGER into these
-- *_staging mirrors, the backtest scores the challenger (via AVM_MATRIX_TABLE/AVM_AUDIT_TABLE
-- pointed here), and the promotion gate copies staging -> live ONLY if the challenger's
-- out-of-time accuracy does not regress. Nothing here touches the live tables; promotion is a
-- separate, gated step. Schema mirrors 006_avm_tables.sql + 011_avm_path_a.sql (base_price).

CREATE TABLE IF NOT EXISTS avm_multiplier_matrix_staging (
  id                SERIAL PRIMARY KEY,
  city_region       VARCHAR(100) NOT NULL,
  property_sub_type VARCHAR(100) NOT NULL,
  feature_name      VARCHAR(50)  NOT NULL,
  beta              FLOAT        NOT NULL DEFAULT 0,
  feat_mean         FLOAT        NOT NULL DEFAULT 0,
  feat_std          FLOAT        NOT NULL DEFAULT 1,
  created_at        TIMESTAMPTZ  DEFAULT NOW(),
  UNIQUE (city_region, property_sub_type, feature_name)
);
CREATE INDEX IF NOT EXISTS idx_avm_matrix_staging_region_type
  ON avm_multiplier_matrix_staging (city_region, property_sub_type);

CREATE TABLE IF NOT EXISTS avm_audit_report_staging (
  id                    SERIAL PRIMARY KEY,
  city_region           VARCHAR(100) NOT NULL,
  property_sub_type     VARCHAR(100) NOT NULL,
  total_sales_analyzed  INTEGER      NOT NULL DEFAULT 0,
  model_accuracy_score  FLOAT        NOT NULL DEFAULT 0,
  average_error_margin  FLOAT        NOT NULL DEFAULT 0,
  base_price            FLOAT,
  created_at            TIMESTAMPTZ  DEFAULT NOW(),
  updated_at            TIMESTAMPTZ  DEFAULT NOW(),
  UNIQUE (city_region, property_sub_type)
);

-- Service-role only (mirrors the live AVM tables; no anon/public access to model internals).
ALTER TABLE avm_multiplier_matrix_staging ENABLE ROW LEVEL SECURITY;
ALTER TABLE avm_audit_report_staging      ENABLE ROW LEVEL SECURITY;
