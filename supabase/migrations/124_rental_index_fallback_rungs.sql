-- 124: rental_market_index — two fallback rungs below `city`, and a published tier.
--
-- WHY
-- ───
-- Measured over the 108,532 active for-sale listings of a rentable sub-type, the
-- three existing rungs reach 76.0%. 26,096 listings get no rent comp at all, and
-- until the no-rent guard shipped alongside this, each of them published a
-- fabricated negative cap rate instead of nothing.
--
-- Two new rungs close most of that gap using only IDX data — no VOW source, so the
-- cap rate stays ungated:
--
--   city_family : hold the city, relax the sub-type to its family (condo-ish vs the
--                 rest). Location dominates rent, so this is the cheaper relaxation.
--   county      : hold the exact sub-type, widen the geography to CountyOrParish.
--
--   scenario                        covered   uncovered
--   today (3 rungs)                   76.0%      26,096
--   + city_family + county            94.5%       6,005
--
-- A third candidate, county + family, was measured and REJECTED: 16.72% median /
-- 56.0% p90 error for only 1.9% more coverage. It is deliberately not built.
--
-- ACCURACY, AND WHY THE TIER IS NOW PUBLISHED
-- Leave-one-out error by rung, each measured on the population that actually lands
-- on it:
--
--   nbhd + baths     5.56%   p90 19.5%     37,318 listings
--   city + baths     8.22%   p90 28.6%     30,235
--   city            13.73%   p90 47.6%     14,883   <- already live, pre-124
--   city_family     13.17%   p90 42.9%      8,368   <- new
--   county          14.49%   p90 45.5%     11,723   <- new
--
-- The new rungs are at parity with a rung already in production, which is the bar
-- they had to clear. But 13-15% on a rent AMPLIFIES into the cap rate, because NOI
-- is rent minus operating cost and a percentage error on the minuend becomes a
-- larger one on the difference. CAP_RATE_BAND cannot catch it: a wrong 4.2% looks
-- exactly like a right 4.2%.
--
-- So the tier stops being an internal detail. rentAVM already returned match_tier;
-- from here the ETL writes it onto the listing document (`rent_match_tier`) so a
-- surface can tell a neighbourhood-grade comp from an area figure. That also fixes
-- the pre-existing case: the `city` rung has been shown identically to a
-- neighbourhood comp all along.
--
-- SHAPE
-- Both new rungs follow the table's existing idiom — a column is NULL when the rung
-- does not key on it, exactly as city_region is NULL on city rows and bedrooms_above
-- is NULL on merged rows.
--
--   city_family row:  city set, property_sub_type NULL, sub_type_family set
--   county      row:  county set, city NULL, property_sub_type set

ALTER TABLE rental_market_index ADD COLUMN IF NOT EXISTS county TEXT;           -- NULL unless match_tier='county'
ALTER TABLE rental_market_index ADD COLUMN IF NOT EXISTS sub_type_family TEXT;  -- NULL unless the rung pools sub-types

-- Family rows key on the family, not on a single sub-type, so the NOT NULL has to go.
ALTER TABLE rental_market_index ALTER COLUMN property_sub_type DROP NOT NULL;

COMMENT ON COLUMN rental_market_index.county IS
  'CountyOrParish. Set only on match_tier=''county'' rows, where city is NULL.';
COMMENT ON COLUMN rental_market_index.sub_type_family IS
  'Pooled sub-type family (''condo''|''freehold'', see src/lib/listings/subTypeFamily.ts). Set only on rungs that relax the sub-type, where property_sub_type is NULL.';

-- Per-rung lookups, split and merged, matching the pattern from 030/122. The table
-- stays in the low tens of thousands of rows, so these are instant.
CREATE INDEX IF NOT EXISTS idx_rmi_city_family
  ON rental_market_index (city, sub_type_family, bedrooms_total)
  WHERE match_tier = 'city_family';
CREATE INDEX IF NOT EXISTS idx_rmi_city_family_split
  ON rental_market_index (city, sub_type_family, bedrooms_above, den)
  WHERE match_tier = 'city_family' AND bedrooms_above IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rmi_county
  ON rental_market_index (county, property_sub_type, bedrooms_total)
  WHERE match_tier = 'county';
CREATE INDEX IF NOT EXISTS idx_rmi_county_split
  ON rental_market_index (county, property_sub_type, bedrooms_above, den)
  WHERE match_tier = 'county' AND bedrooms_above IS NOT NULL;

-- Uniqueness must separate the new rungs from the old ones, or the rebuild collides
-- halfway through its TRUNCATE+INSERT. Same COALESCE idiom 122 established.
DROP INDEX IF EXISTS uniq_rmi_tier;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_rmi_tier
  ON rental_market_index (match_tier, COALESCE(city_region,''), COALESCE(city,''),
                          COALESCE(county,''), COALESCE(property_sub_type,''),
                          COALESCE(sub_type_family,''), bedrooms_total,
                          COALESCE(bathrooms,-1), COALESCE(bedrooms_above,-1),
                          COALESCE(den,-1));

-- region_rental_yield needs NO change. It selects match_tier IN ('city','nbhd') only,
-- so the new rungs cannot reach it and its sample counts stay exactly as 122 left
-- them. Verified against the live definition rather than the migration files, which
-- have drifted (see the note in 122).

-- ── listings.rent_match_tier ────────────────────────────────────────────────────
-- The tier is written onto the Typesense document for the UI, and HERE so the value
-- is queryable and, more importantly, so the recompute job can tell whether a row
-- already carries the right one. Without it that job only writes rows whose cap rate
-- drifted, and a listing with a correct-but-area-grade cap rate would keep
-- comp-grade presentation forever — the exact split-brain this codebase keeps
-- hitting when a derived value has no way to be re-checked.
ALTER TABLE listings ADD COLUMN IF NOT EXISTS rent_match_tier TEXT;

COMMENT ON COLUMN listings.rent_match_tier IS
  'Rung of the rent ladder behind cap_rate_est (nbhd|city_bath|city|city_family|county). NULL = no rent comp. Confidence bands live in src/lib/metrics/rentTier.ts.';
