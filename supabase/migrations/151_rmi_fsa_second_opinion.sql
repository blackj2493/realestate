-- 151: rental_market_index — an FSA-keyed cohort, as a SECOND OPINION only.
--
-- WHY
-- ───
-- 150 withholds a cap rate when the cohort behind it disagrees with itself (spread > 0.5).
-- That catches 1.62% of the live book and genuine junk with it — $11,000/mo from 3 comps.
-- It does NOT catch the listing that prompted the work:
--
--   473 Dupont St #2   nbhd_size   $7,000   n=6    spread 0.104   -> looks reliable
--
-- Six large expensive Annex condos agreeing with each other IS a tight cohort. Dispersion
-- measures whether comps agree, not whether they are the right comps. Every lease within
-- 1 km says ~$3,100.
--
-- The board's neighbourhood label is what pools them: "Annex" spans M5R (median $2,900) and
-- M6G ($2,175). The postal FSA splits exactly that, and — unlike the radius cohorts measured
-- and rejected in 150 — it needs NO per-listing geo query. It is just another cohort key.
--
-- MEASURED, on the same 38,301 held-out closed leases as 150
-- ─────────────────────────────────────────────────────────
-- As a LADDER RUNG it FAILS, and is deliberately not used as one:
--
--   live ladder          5.45% median err   1.13% blow-up
--   FSA rungs on top     5.53%              1.15%
--
-- That is the fifth regrouping of these leases to fail. As a WITHHOLD signal it works:
--
--   flag                          flagged   blow-in   blow-out   recall    lift
--   spread > 0.5  (150)             1.46%    18.13%      0.87%    23.5%   16.1x
--   FSA disagrees > 1.65x           0.51%    21.51%      1.02%     9.7%   19.1x
--   either                          1.78%    16.74%      0.84%    26.5%   14.9x
--
-- On 473 Dupont: ladder $7,200 (n=6) against FSA M6G $2,500 (n=106) = 2.88x. It fires.
--
-- Note the FSA cohort says $2,500 where reality is ~$3,100 — 19% low. It is a good DETECTOR
-- and a poor ESTIMATOR, which is why this is a withhold rule and not a substitution. 150
-- measured substitution directly: it made blow-ups WORSE, 1.13% -> 1.28%.
--
-- Coverage: 100% of closed leases carry a postal code, 99.93% of active listings a valid FSA.

ALTER TABLE rental_market_index
  ADD COLUMN IF NOT EXISTS fsa TEXT;  -- NULL unless the rung keys on it

COMMENT ON COLUMN rental_market_index.fsa IS
  'Forward sortation area — first three characters of the postal code. Set only on match_tier = ''fsa''; NULL on every other rung. A SECOND OPINION for the 151 withhold check, never a ladder rung: measured as a rung it is worse than the ladder it would sit above.';

-- ─────────────────────────────────────────────────────────────────────────────────────
-- THE UNIQUENESS KEY. This is the half that 148 forgot, and forgetting it emptied the
-- table in production: the refresh TRUNCATES before it inserts, so a collision mid-insert
-- leaves nothing behind. Every `fsa` row shares match_tier, basis, sub-type and bedrooms
-- with every other, and keys on NOTHING else in the current index — city_region, city,
-- county, bathrooms and living_area_range are all NULL on this rung. Without `fsa` in the
-- key, M6G/Condo/2bd and M5R/Condo/2bd are the SAME ROW and the rebuild dies.
--
-- A dry run cannot catch this. It writes nothing, so it never reaches the constraint.
-- ─────────────────────────────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS uniq_rmi_tier;

CREATE UNIQUE INDEX uniq_rmi_tier ON public.rental_market_index USING btree (
  match_tier,
  basis,
  COALESCE(city_region, ''::text),
  COALESCE(city, ''::text),
  COALESCE(county, ''::text),
  COALESCE(property_sub_type, ''::text),
  COALESCE(sub_type_family, ''::text),
  bedrooms_total,
  COALESCE(bathrooms, '-1'::integer),
  COALESCE(bedrooms_above, '-1'::integer),
  COALESCE((den)::integer, '-1'::integer),
  COALESCE(living_area_range, '-1'::integer),
  COALESCE(fsa, ''::text)
);

-- Lookup indexes for the single probe fetchRentAVM makes, merged and split, matching the
-- idiom in 030/122/124/148.
CREATE INDEX IF NOT EXISTS idx_rmi_fsa
  ON rental_market_index (fsa, property_sub_type, bedrooms_total)
  WHERE match_tier = 'fsa';
CREATE INDEX IF NOT EXISTS idx_rmi_fsa_split
  ON rental_market_index (fsa, property_sub_type, bedrooms_above, den)
  WHERE match_tier = 'fsa' AND bedrooms_above IS NOT NULL;

-- Safe to apply ahead of the rebuild. Until refreshRentalMarketIndex runs there are no
-- `fsa` rows, the second-opinion probe returns nothing, rentTierConfidence() sees a null
-- disagreement and answers exactly as it does today. The gate turns on with the rebuild,
-- not with this file — same property 150 was built to have.
