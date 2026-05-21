-- ============================================================================
-- Shadow MLS - Fix list_price type: BIGINT -> NUMERIC
-- ============================================================================
--
-- Problem: listings.list_price was created as BIGINT (migration 001). The TRREB
-- feed sends fractional ListPrice values for commercial LEASE listings priced
-- per square foot (e.g. 15.95, 16.5, 18.95 $/sqft/yr). Postgres rejects decimals
-- on a bigint column:
--   "invalid input syntax for type bigint: \"16.5\""
-- which fails the ENTIRE row upsert for those listings.
--
-- Migration 003 documented the intent to store these as numeric but its ALTER
-- statements were left commented out, so the column was never actually changed.
-- This migration performs that change. NUMERIC preserves whole-dollar sale prices
-- AND fractional per-sqft lease rates with no precision loss. Range filtering and
-- the existing price indexes continue to work on a numeric column.
--
-- Run: supabase db push (or paste into the Supabase SQL Editor).
-- Safe to re-run: guarded so it only alters when the column is still bigint.
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'listings'
      AND column_name = 'list_price'
      AND data_type = 'bigint'
  ) THEN
    ALTER TABLE listings
      ALTER COLUMN list_price TYPE NUMERIC USING list_price::numeric;
    RAISE NOTICE 'listings.list_price converted from bigint to numeric';
  ELSE
    RAISE NOTICE 'listings.list_price is not bigint - no change made';
  END IF;
END $$;

COMMENT ON COLUMN listings.list_price IS
  'List price. NUMERIC to hold whole-dollar sale prices AND fractional commercial lease rates ($/sqft). Was bigint until migration 011.';
