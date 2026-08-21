-- 125: a REAL suite rent, and the retirement of the 1.6x multiplier.
--
-- WHY
-- ───
-- rentAVM.ts multiplied a listing's whole-home rent by 1.6 whenever the multi-unit
-- scorer called it a suite candidate. Measured against production on 2026-08-21:
--
--   status                 listings   gets x1.6
--   NOT_VIABLE               86,880      no
--   PRIME_CANDIDATE          42,022     YES
--   MARGINAL_CANDIDATE       35,372     YES
--   EXISTING_MULTI_UNIT      24,891     YES
--
-- 102,285 active for-sale listings — 54.1% of the book — carried a 60% rent uplift,
-- and 83,882 of them have no second kitchen anywhere. PRIME and MARGINAL are SCORED,
-- not observed: a full basement, a separate entrance and three parking spots scores 4
-- with nothing built. That uplift flowed into annual_revenue -> gross_yield_est ->
-- cap_rate_est -> net_monthly_cashflow, and out to Deal Score and the sandbox.
--
-- Where a suite plausibly DOES exist, the constant is still wrong. Against real comps
-- on 13,003 comparable suite candidates:
--
--   today   mixed whole-home comp x 1.6        median $6,078/mo
--   whole   clean whole-home comp, no uplift   median $3,800/mo
--   split   clean main-unit comp + suite comp  median $4,950/mo
--
-- Today overstates the honest split underwrite on 93.8% of them, median +20.6%, and
-- by more than 20% on half. The multiplier real suite economics imply is 1.32x.
--
-- WHAT REPLACES IT
-- A real rung, built from the leases the ladder was throwing away. 10,756 of 89,685
-- active for-lease listings (12.0%) are in-home units — basements, upper units, main-
-- floor units — identified by the SAME address classifier the address-profile rents
-- grid has used since the 2026-07-24 Brampton incident, now shared from
-- src/lib/listings/inHomeUnit.ts. They give 1,086 neighbourhood cohorts and 331 city
-- cohorts at n>=3, covering 84.3% of the listings that need one.
--
-- Those leases were ALSO polluting the whole-home cohorts they were folded into.
-- Removing them moves 410 house cohorts by >=1%, the worst by 72% (Toronto C07
-- Detached 2bd: $1,975 -> $2,500 — the same signature as Brampton).
--
-- WHO GETS SUITE INCOME NOW
-- Only where a suite is OBSERVED, never where it is scored:
--   house + KitchensBelowGrade > 0 or Basement 'Apartment'   18,699   counted
--   plex sub-type (Duplex/Triplex/...)                        2,843   comp already covers it
--   PRIME / MARGINAL scored candidates                       83,882   not counted
--   PublicRemarks regex only                                  3,349   not counted
-- The remarks trigger decides itself: 3,187 of its 3,349 hits are "in-law suite",
-- which is family accommodation, not rent.
--
-- SHAPE
-- Suite cohorts live in rental_market_index beside the whole-home rungs, on their own
-- match_tier values so the existing ladder walk can never return one by accident:
--
--   suite_nbhd : city_region + bedrooms_total, property_sub_type NULL,
--                sub_type_family 'in_home_unit'
--   suite_city : city        + bedrooms_total, same
--
-- region_rental_yield needs no change — it selects match_tier IN ('city','nbhd'),
-- which these do not match. Verified against the live definition, not the migration
-- files, which have drifted (see the note in 122).

-- Suite rows key on the family, and bathrooms/bedrooms_above/den are all NULL on them,
-- which the 124 unique index already tolerates via its COALESCE idiom. No index change
-- is needed for uniqueness; these two are for the lookup itself.
CREATE INDEX IF NOT EXISTS idx_rmi_suite_nbhd
  ON rental_market_index (city_region, bedrooms_total)
  WHERE match_tier = 'suite_nbhd';
CREATE INDEX IF NOT EXISTS idx_rmi_suite_city
  ON rental_market_index (city, bedrooms_total)
  WHERE match_tier = 'suite_city';

-- ── listings.suite_rent_est ─────────────────────────────────────────────────────
-- Stored for the same reason 124 stored rent_match_tier: without it the recompute job
-- cannot tell whether a row already carries the right value, and a listing whose suite
-- rent is stale keeps it forever. This is the monthly figure, not annual.
ALTER TABLE listings ADD COLUMN IF NOT EXISTS suite_rent_est NUMERIC;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS suite_rent_tier TEXT;

COMMENT ON COLUMN listings.suite_rent_est IS
  'Monthly rent for an OBSERVED in-home suite (below-grade kitchen or basement apartment), from the suite_nbhd/suite_city rungs. NULL = no suite observed, or no cohort. Never set from a scored candidate — see migration 125.';
COMMENT ON COLUMN listings.suite_rent_tier IS
  'Which suite rung answered (suite_nbhd|suite_city). NULL when suite_rent_est is NULL.';
