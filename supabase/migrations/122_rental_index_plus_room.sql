-- 122: rental_market_index — split "+1" homes out of the whole-bedroom cohorts.
--
-- TRREB reports beds as two fields and the feed's BedroomsTotal is their SUM, so a
-- 1-bed-plus-den has always been keyed here as a 2 bedroom. It is not one. Measured
-- on Toronto condo apartments over 24 months: a true 2 bd leases at $2,950 and a 1+1
-- at $2,450, and the pooled "2 bed" cohort was 52.6% plus-den — so the number it
-- published described neither home.
--
-- Out-of-time backtest over 56,228 leases (train through 2026-02, test 2026-03..08)
-- scoring each lease against its cohort median: median absolute error 7.69% merged
-- vs 6.67% split, and the split won at EVERY cohort depth including 1-2 samples
-- (9.17% vs 11.32%). Unlike the sale side, rents never need a sample floor to
-- justify the split — rent distributions are tight enough that the plus-room gap
-- dominates from the first observation.
--
-- BOTH keyings are stored, not just the split one. Splitting alone costs coverage:
-- measured over the 94,356 active for-lease listings, the share that still find a
-- cohort at min-N drops from 76,869 to 75,039. The lookup prefers the split row and
-- falls back to the merged row, so those 1,830 listings keep an estimate instead of
-- going null — and a null here does not fail loudly, it freezes into the nightly
-- precompute as a missing cap rate.
--
--   split  row:  bedrooms_above = 1, den = 1   (a 1+den)
--   merged row:  bedrooms_above IS NULL,       bedrooms_total = 2  (today's semantics)
--
-- `bedrooms_total` keeps its meaning on merged rows and is informational on split
-- rows, so nothing that reads the old shape breaks before the next refresh.

ALTER TABLE rental_market_index ADD COLUMN IF NOT EXISTS bedrooms_above INTEGER;  -- NULL = merged row
ALTER TABLE rental_market_index ADD COLUMN IF NOT EXISTS den SMALLINT;            -- NULL = merged row, else 0|1

COMMENT ON COLUMN rental_market_index.bedrooms_above IS
  'Whole bedrooms above grade. NULL marks a MERGED cohort keyed on bedrooms_total (the pre-122 shape).';
COMMENT ON COLUMN rental_market_index.den IS
  'Capped plus-room flag: 1 = has a den / below-grade bedroom. NULL marks a merged cohort.';

-- Per-tier split lookups. Partial, and the table stays in the low tens of thousands.
CREATE INDEX IF NOT EXISTS idx_rmi_nbhd_split
  ON rental_market_index (city_region, property_sub_type, bedrooms_above, den, bathrooms)
  WHERE match_tier = 'nbhd' AND bedrooms_above IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rmi_city_bath_split
  ON rental_market_index (city, property_sub_type, bedrooms_above, den, bathrooms)
  WHERE match_tier = 'city_bath' AND bedrooms_above IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rmi_city_split
  ON rental_market_index (city, property_sub_type, bedrooms_above, den)
  WHERE match_tier = 'city' AND bedrooms_above IS NOT NULL;

-- Uniqueness must now separate a split row from the merged row it sits beside, or
-- the two collide on (tier, region, sub_type, bedrooms_total, baths) and the rebuild
-- fails halfway through a TRUNCATE+INSERT.
DROP INDEX IF EXISTS uniq_rmi_tier;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_rmi_tier
  ON rental_market_index (match_tier, COALESCE(city_region,''), COALESCE(city,''),
                          property_sub_type, bedrooms_total, COALESCE(bathrooms,-1),
                          COALESCE(bedrooms_above,-1), COALESCE(den,-1));

-- ── region_rental_yield: pin to the MERGED rows ──────────────────────────────────
--
-- The table now holds two rows per cohort (split + merged fallback), and this RPC
-- does `sum(sample_count)` over everything matching the region. Left alone it would
-- count every lease twice and double the sample figure the panel prints.
--
-- Pinned to `bedrooms_above IS NULL`, so the panel returns byte-identical numbers to
-- before 122. Recreated verbatim from the LIVE definition (pg_get_functiondef, not
-- the 062/085/088 migration files, which have drifted) with that one predicate added.
--
-- NOTE, pre-existing and NOT fixed here: the rent CTE groups by `bedrooms_total`
-- (den-inclusive) while the price CTE groups by `bedrooms_above_grade` (den-
-- exclusive), and they join on beds. A 2+den's rent is therefore already paired with
-- a true 3-bedroom's sale price, so the gross yield on those rows compares two
-- different populations. The split columns make that fixable — point the rent CTE at
-- `bedrooms_above` and both sides finally mean the same thing — but it MOVES the
-- published yield numbers, so it belongs in its own change, not this one.
CREATE OR REPLACE FUNCTION public.region_rental_yield(p_region text, p_subtypes text[] DEFAULT NULL::text[])
 RETURNS TABLE(beds integer, typical_rent integer, rent_sample integer, median_price bigint, price_sample integer, gross_yield_pct numeric)
 LANGUAGE sql
 STABLE
 SET statement_timeout TO '60s'
AS $function$
  WITH rent AS (
    SELECT
      bedrooms_total AS beds,
      round(sum(avg_rent * greatest(sample_count, 1)) / sum(greatest(sample_count, 1)))::int AS rent,
      sum(coalesce(sample_count, 0))::int AS rent_n
    FROM rental_market_index
    WHERE (
        (match_tier = 'city' AND lower(city)        = lower(p_region))
     OR (match_tier = 'nbhd' AND lower(city_region) = lower(p_region))
     OR (match_tier = 'city'                                                  -- 085: Toronto districts
         AND lower(city) >= lower(p_region) || ' '
         AND lower(city) <  lower(p_region) || chr(33)
         AND lower(city) ~ ('^' || lower(p_region) || ' [cwe][0-9][0-9]$'))
     OR (match_tier = 'city' AND lower(city) = ANY (ARRAY(SELECT member_city FROM region_aliases WHERE region = lower(p_region))))  -- 088: Ottawa areas
      )
      AND bedrooms_above IS NULL   -- 122: merged rows only; split rows would double-count
      AND avg_rent > 0
      AND (p_subtypes IS NULL OR property_sub_type = ANY (p_subtypes))
      AND bedrooms_total BETWEEN 1 AND 5
    GROUP BY 1
  ),
  price AS (
    SELECT
      bedrooms_above_grade AS beds,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY close_price)::bigint AS price,
      count(*)::int AS price_n
    FROM raw_vow_sold
    WHERE (
        lower(city) = lower(p_region)
        OR lower(city_region) = lower(p_region)
        OR (
          lower(city) >= lower(p_region) || ' '
          AND lower(city) <  lower(p_region) || chr(33)
          AND lower(city) ~ ('^' || lower(p_region) || ' [cwe][0-9][0-9]$')
        )
        OR lower(raw_payload->>'CountyOrParish') = lower(p_region)
        OR lower(city) = ANY (ARRAY(SELECT member_city FROM region_aliases WHERE region = lower(p_region)))                          -- 088
      )
      AND transaction_type = 'For Sale'
      AND close_price >= 50000
      AND purchase_contract_date >= current_date - interval '12 months'
      AND (p_subtypes IS NULL OR property_sub_type = ANY (p_subtypes))
      AND bedrooms_above_grade BETWEEN 1 AND 5
    GROUP BY 1
  )
  SELECT
    r.beds,
    r.rent,
    r.rent_n,
    p.price,
    coalesce(p.price_n, 0),
    CASE WHEN p.price > 50000 AND p.price_n >= 5
         THEN round((r.rent * 12.0) / p.price * 100, 2) ELSE NULL END
  FROM rent r
  LEFT JOIN price p ON p.beds = r.beds
  WHERE r.rent_n > 0
  ORDER BY r.beds;
$function$;
