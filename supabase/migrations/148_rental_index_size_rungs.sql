-- 148: rental_market_index — three size-keyed rungs above the existing ladder.
--
-- WHY
-- ───
-- The ladder keys on region/city × sub-type × bedrooms × bathrooms. SIZE appears in
-- no rung, so bathroom count silently acts as a size proxy — and on an unusual shape
-- the proxy inverts.
--
-- 130 River St #1508 is a 650 sqft condo listed with 3 bathrooms. It matched the
-- Toronto C08 / 2 bed / 3 bath cohort (n=31), whose leases have a MEDIAN SIZE of
-- 1,900 sqft — Merchants' Wharf and Queens Quay penthouses — and published $5,200/mo.
-- Two units in the same building, same size, leased that month for $2,900 and $3,000.
--
-- The right answer was already one rung lower and unreachable:
--
--   city_bath          $4,575   n=50      <- what production picked
--   city + size        $2,550   n=3,482   <- what this migration makes reachable
--
-- A 50-sample bathroom match was preferred over a 3,482-sample size match.
--
-- MEASURED
-- ────────
-- Backtest over 243,060 training leases predicting 37,812 held out (the most recent
-- ~12%), walking the real ladder for each:
--
--   ladder                 coverage   median |%err|   within 15%
--   current (no size)        95.3%        6.2%          82.6%
--   size-first               95.3%        5.4%          86.1%
--
-- Coverage is IDENTICAL because the size rungs fall back to the existing ones when a
-- size cohort is thin. There is no coverage/accuracy trade to weigh here — the size
-- rungs strictly dominate, which is why they go ABOVE the whole existing ladder
-- rather than being interleaved.
--
-- A strict variant that refuses the size-less fallback entirely was measured and
-- REJECTED: it cuts the >50% blowup rate from 1.11% to 0.77% but drops coverage to
-- 86.6%, losing ~6,200 listings an estimate to avoid ~240 bad ones. The per-size rent
-- ceiling shipped separately (RENT_CEILING_BY_SIZE) handles that residue without the
-- coverage loss.
--
-- Also measured and deliberately NOT changed: MIN_COHORT_SAMPLES. From 3 to 30 the
-- median error moves 5.4% -> 5.6% while coverage falls 96.9% -> 85.4%. The cohort that
-- caused this had n=31; no plausible floor would have caught it. n is not the lever.
--
-- SHAPE
-- ─────
-- Same idiom as 122/124: a column is NULL when the rung does not key on it. Size rows
-- carry living_area_range; every pre-existing row keeps it NULL and is untouched.
--
--   nbhd_size      row: city_region set, bathrooms set, living_area_range set
--   city_bath_size row: city set, bathrooms set, living_area_range set
--   city_size      row: city set, bathrooms NULL, living_area_range set
--
-- living_area_range is the ROUNDED band midpoint, matching what raw_vow_sold already
-- stores ("600-699" -> 650). Both sides canonicalise through livingAreaBandKey() so a
-- lease row and a listing lookup cannot land on different keys.

ALTER TABLE rental_market_index
  ADD COLUMN IF NOT EXISTS living_area_range INTEGER;  -- NULL unless the rung keys on size

COMMENT ON COLUMN rental_market_index.living_area_range IS
  'Rounded TRREB living-area band midpoint ("600-699" -> 650), matching raw_vow_sold.living_area_range. Set only on match_tier in (''nbhd_size'',''city_bath_size'',''city_size''); NULL on every other rung.';

-- Per-rung lookups, split and merged, matching 030/122/124. The table stays in the low
-- tens of thousands of rows, so these are instant.
CREATE INDEX IF NOT EXISTS idx_rmi_nbhd_size
  ON rental_market_index (city_region, property_sub_type, bedrooms_total, bathrooms, living_area_range)
  WHERE match_tier = 'nbhd_size';
CREATE INDEX IF NOT EXISTS idx_rmi_nbhd_size_split
  ON rental_market_index (city_region, property_sub_type, bedrooms_above, den, bathrooms, living_area_range)
  WHERE match_tier = 'nbhd_size' AND bedrooms_above IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rmi_city_bath_size
  ON rental_market_index (city, property_sub_type, bedrooms_total, bathrooms, living_area_range)
  WHERE match_tier = 'city_bath_size';
CREATE INDEX IF NOT EXISTS idx_rmi_city_bath_size_split
  ON rental_market_index (city, property_sub_type, bedrooms_above, den, bathrooms, living_area_range)
  WHERE match_tier = 'city_bath_size' AND bedrooms_above IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rmi_city_size
  ON rental_market_index (city, property_sub_type, bedrooms_total, living_area_range)
  WHERE match_tier = 'city_size';
CREATE INDEX IF NOT EXISTS idx_rmi_city_size_split
  ON rental_market_index (city, property_sub_type, bedrooms_above, den, living_area_range)
  WHERE match_tier = 'city_size' AND bedrooms_above IS NOT NULL;

-- The new rungs only exist once the index is rebuilt. Until then fetchRentAVM finds no
-- size rows, falls straight through to the rungs it uses today, and nothing changes —
-- so this migration is safe to apply ahead of the rebuild.
