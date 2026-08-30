-- 133 — rental_market_index learns WHERE its rent came from.
--
-- Every cohort in this table has been an ASKING rent since it was created: the ETL
-- read `listings.list_price` on for-lease records and nothing else. `raw_vow_sold`
-- holds 271,287 CLOSED lease records — 234,100 of them inside 24 months and past the
-- price band and the in-home-unit filter — and the ladder read none of them.
--
-- After this, one cohort key can hold up to three rows, one per basis:
--
--   closed_12   median of signed leases closed in the last 12 months
--   closed_24   ditto over 24 months (INCLUSIVE of the 12 — it keeps a thin cohort
--               alive, it does not describe months 13-24)
--   asking      median of ACTIVE for-lease asks (status new / price change / extension)
--
-- The lookup prefers them in that order WITHIN a rung, then relaxes the geography.
-- Measured out-of-time against 40,408 closes the index could not have seen:
-- asking-only 95.6% covered / 6.52% median error → closed-first 98.7% / 5.53%.
--
-- Reversible: drop the column and the old unique key comes back. Every row is derived,
-- so `refreshRentalMarketIndex --apply` rebuilds the table from scratch either way.

ALTER TABLE public.rental_market_index
  ADD COLUMN IF NOT EXISTS basis text NOT NULL DEFAULT 'asking';

-- The default is what makes this migration safe to run BEFORE the new ETL ships: every
-- existing row is an ask, and labelling it truthfully costs nothing.
ALTER TABLE public.rental_market_index
  DROP CONSTRAINT IF EXISTS rental_market_index_basis_check;
ALTER TABLE public.rental_market_index
  ADD CONSTRAINT rental_market_index_basis_check
  CHECK (basis IN ('closed_12', 'closed_24', 'asking'));

-- THE UNIQUE KEY MUST INCLUDE basis, or the second pass of the ETL collides with the
-- first on every shared cohort key and the insert dies half way through a TRUNCATE +
-- repopulate — which would leave the table holding one basis and nothing else.
DROP INDEX IF EXISTS public.uniq_rmi_tier;
CREATE UNIQUE INDEX uniq_rmi_tier ON public.rental_market_index
  USING btree (
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
    COALESCE((den)::integer, '-1'::integer)
  );

-- The per-rung partial indexes are deliberately NOT changed. The lookup asks for every
-- basis at a key in ONE query and ranks them in TypeScript, so `basis` is a returned
-- column rather than a filtered one — adding it to those indexes would widen them for
-- no gain. Keeping the ranking in TS also keeps it inside the unit tests, instead of in
-- an RPC body that the test suite cannot see.

COMMENT ON COLUMN public.rental_market_index.basis IS
  'Where the median came from: closed_12 / closed_24 = signed leases from raw_vow_sold '
  'over that window; asking = active for-lease list prices. Never pooled — an ask is an '
  'offer, a close is a transaction. See src/lib/metrics/rentTier.ts (133).';

-- ── region_rental_yield MUST collapse to one row per cohort ──────────────────────
--
-- /analytics weight-averages cohorts: sum(avg_rent * sample_count) / sum(sample_count).
-- That arithmetic assumes ONE ROW PER COHORT KEY, which was true until this migration
-- and is false after it. Left alone it would count every cohort up to three times, and
-- because closed_24 CONTAINS closed_12 it would count many of the same signed leases
-- twice inside a single average — while `rent_sample`, the honesty number printed next
-- to the figure, inflated by roughly 3x.
--
-- This is the same trap migration 123 hit with the split/merged rows (see its
-- `bedrooms_above IS NOT NULL -- merged rows would double-count` line, preserved
-- below). Adding a second axis to this table without revisiting this function is
-- evidently the mistake it invites, so the DISTINCT ON is written to survive a third.
--
-- The ranking inside the DISTINCT ON is the SAME order RENT_BASIS_PREFERENCE walks in
-- src/lib/metrics/rentTier.ts. If one moves, move the other — /analytics quoting a
-- different basis than the listing page is precisely the class of split this repo keeps
-- paying for.
--
-- Body copied from the LIVE definition (pg_get_functiondef), not from the migration
-- files, which have drifted — see the note in 122 and 125.
-- THE DEFAULT IS PART OF THE SIGNATURE. `CREATE OR REPLACE FUNCTION` cannot remove a
-- parameter default from an existing function, and the first cut of this migration
-- dropped `DEFAULT NULL::text[]` and failed with
--   "cannot remove parameter defaults from existing function".
-- It was written from pg_get_function_IDENTITY_arguments, which deliberately omits
-- defaults because it exists to identify an overload, not to reproduce a declaration.
-- Read pg_get_function_arguments when the goal is to rewrite the function.
CREATE OR REPLACE FUNCTION public.region_rental_yield(p_region text, p_subtypes text[] DEFAULT NULL::text[])
RETURNS TABLE(beds integer, typical_rent integer, rent_sample integer,
              median_price bigint, price_sample integer, gross_yield_pct numeric)
LANGUAGE sql
STABLE
AS $$
  WITH one_per_cohort AS (
    SELECT DISTINCT ON (match_tier, city, city_region, county, property_sub_type,
                        sub_type_family, bedrooms_total, bedrooms_above, den, bathrooms)
           match_tier, city, city_region, property_sub_type,
           bedrooms_above, avg_rent, sample_count
      FROM rental_market_index
     ORDER BY match_tier, city, city_region, county, property_sub_type,
              sub_type_family, bedrooms_total, bedrooms_above, den, bathrooms,
              CASE basis WHEN 'closed_12' THEN 1 WHEN 'closed_24' THEN 2 ELSE 3 END
  ),
  rent AS (
    SELECT
      bedrooms_above AS beds,
      round(sum(avg_rent * greatest(sample_count, 1)) / sum(greatest(sample_count, 1)))::int AS rent,
      sum(coalesce(sample_count, 0))::int AS rent_n
    FROM one_per_cohort
    WHERE (
        (match_tier = 'city' AND lower(city)        = lower(p_region))
     OR (match_tier = 'nbhd' AND lower(city_region) = lower(p_region))
     OR (match_tier = 'city'                                                  -- 085: Toronto districts
         AND lower(city) >= lower(p_region) || ' '
         AND lower(city) <  lower(p_region) || chr(33)
         AND lower(city) ~ ('^' || lower(p_region) || ' [cwe][0-9][0-9]$'))
     OR (match_tier = 'city' AND lower(city) = ANY (ARRAY(SELECT member_city FROM region_aliases WHERE region = lower(p_region))))  -- 088: Ottawa areas
      )
      AND bedrooms_above IS NOT NULL   -- 123: SPLIT rows; merged rows would double-count
      AND avg_rent > 0
      AND (p_subtypes IS NULL OR property_sub_type = ANY (p_subtypes))
      AND bedrooms_above BETWEEN 1 AND 5
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
$$;
