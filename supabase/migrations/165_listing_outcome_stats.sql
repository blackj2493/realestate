-- Migration 165: listing_outcome_stats — why homes do not sell, per region (2026-11).
--
-- For /house-not-selling and /house-not-selling/{city} ("why is my house not selling").
-- One row per (region, outcome) over the last 12 months, PROPERTY level, SALE only:
--   outcome 'sold'   = a distinct address (+ city) with a sale (raw_vow_sold) in the window
--   outcome 'unsold' = a distinct address that came off the market (raw_vow_delisted:
--                      expired / terminated / suspended), did NOT sell in the window, and is
--                      NOT for sale again now (listings.norm_address). Same definition as
--                      region_listing_outcomes (072), so the share matches /analytics.
-- For each group: price cuts (original vs final asking), days on the market, and the
-- asking price against the median SALE price of similar homes = same city + community +
-- sub-type + above-grade bedrooms, sold in the window (cohort of 5+ sales).
--
-- Regions: Toronto districts roll up to 'toronto', Ottawa areas to 'ottawa' (region_aliases),
-- other cities by lower(city), plus 'ontario'. Flat columns only (no raw_payload): ~8s.
-- Nightly by scripts/admin/refresh-listing-outcomes.ts (daily-sync).
--
-- Run: npx tsx scripts/admin/applyMigrationFiles.ts 165_listing_outcome_stats.sql

CREATE TABLE IF NOT EXISTS public.listing_outcome_stats (
  region         text        NOT NULL,
  outcome        text        NOT NULL CHECK (outcome IN ('sold', 'unsold')),
  homes          integer     NOT NULL,
  cut_share      numeric,              -- share whose final asking price was below the first
  median_cut_pct numeric,              -- median cut (%), among those with a cut
  ratio_sample   integer     NOT NULL, -- homes with a similar-homes cohort
  median_ratio   numeric,              -- median of asking / similar homes' median sale price
  over10_share   numeric,              -- share asking > 10% above similar homes
  median_dom     integer,              -- sold: days to sell; unsold: days before it came off
  computed_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (region, outcome)
);

COMMENT ON TABLE public.listing_outcome_stats IS
  'Why homes do not sell (migration 165): per region and outcome (sold / unsold, property level, sale only, last 12 months), price cuts, days on market, and asking price vs the median sale price of similar homes. Filled by refresh_listing_outcome_stats().';

CREATE OR REPLACE FUNCTION public.refresh_listing_outcome_stats()
RETURNS integer
LANGUAGE plpgsql
SET statement_timeout TO '180s'
AS $function$
DECLARE
  n integer;
BEGIN
  -- WHERE true: PostgREST runs pg_safeupdate, which rejects a bare DELETE from an RPC.
  DELETE FROM public.listing_outcome_stats WHERE true;

  WITH s AS (
    SELECT lower(trim(unparsed_address)) AS addr, lower(city) AS lc, city, city_region AS cr,
           property_sub_type AS st, bedrooms_above_grade AS b,
           list_price AS lp, original_list_price AS olp, close_price AS cp, days_on_market AS dom
    FROM raw_vow_sold
    WHERE transaction_type = 'For Sale'
      AND close_price >= 50000
      AND purchase_contract_date >= current_date - interval '12 months'
      AND purchase_contract_date <= current_date
      AND unparsed_address IS NOT NULL AND trim(unparsed_address) <> ''
      AND coalesce(city, '') <> ''
  ),
  s1 AS (   -- one row per sold property (its latest sale)
    SELECT DISTINCT ON (addr, lc) * FROM s ORDER BY addr, lc, cp DESC
  ),
  a AS (    -- for sale again now: not a failure
    SELECT DISTINCT norm_address AS addr, lower(city) AS lc
    FROM listings
    WHERE list_price >= 50000
      AND norm_address IS NOT NULL AND norm_address <> ''
      AND coalesce(standard_status, '') NOT IN ('sold','closed','closed sale','leased','terminated','expired','suspended')
  ),
  d AS (    -- the latest de-listing per property
    SELECT DISTINCT ON (lower(trim(unparsed_address)), lower(city))
           lower(trim(unparsed_address)) AS addr, lower(city) AS lc, city, city_region AS cr,
           property_sub_type AS st, bedrooms_above_grade AS b,
           list_price AS lp, original_list_price AS olp, days_on_market AS dom
    FROM raw_vow_delisted
    WHERE transaction_type = 'For Sale'
      AND list_price >= 50000
      AND delisted_date >= current_date - interval '12 months'
      AND unparsed_address IS NOT NULL AND trim(unparsed_address) <> ''
      AND coalesce(city, '') <> ''
    ORDER BY lower(trim(unparsed_address)), lower(city), delisted_date DESC
  ),
  f AS (
    SELECT d.* FROM d
    WHERE NOT EXISTS (SELECT 1 FROM s1 WHERE s1.addr = d.addr AND s1.lc = d.lc)
      AND NOT EXISTS (SELECT 1 FROM a WHERE a.addr = d.addr AND a.lc = d.lc)
  ),
  cohort AS (
    SELECT city, cr, st, b, percentile_cont(0.5) WITHIN GROUP (ORDER BY cp) AS med
    FROM s1 GROUP BY city, cr, st, b HAVING count(*) >= 5
  ),
  both_ AS (
    SELECT 'sold'::text AS outcome, s1.city, s1.lp, s1.olp, s1.dom, s1.lp / c.med AS r
    FROM s1 LEFT JOIN cohort c ON c.city = s1.city AND c.cr IS NOT DISTINCT FROM s1.cr AND c.st IS NOT DISTINCT FROM s1.st AND c.b IS NOT DISTINCT FROM s1.b
    UNION ALL
    SELECT 'unsold', f.city, f.lp, f.olp, f.dom, f.lp / c.med
    FROM f LEFT JOIN cohort c ON c.city = f.city AND c.cr IS NOT DISTINCT FROM f.cr AND c.st IS NOT DISTINCT FROM f.st AND c.b IS NOT DISTINCT FROM f.b
  ),
  tagged AS (
    SELECT
      CASE
        WHEN city ~* '^toronto [cew][0-9]{2}$' THEN 'toronto'
        WHEN lower(city) IN (SELECT member_city FROM region_aliases WHERE region = 'ottawa') THEN 'ottawa'
        ELSE lower(city)
      END AS region,
      outcome, lp, olp, dom,
      CASE WHEN r BETWEEN 0.3 AND 3 THEN r END AS r
    FROM both_
  ),
  scoped AS (
    SELECT region, outcome, lp, olp, dom, r FROM tagged
    UNION ALL
    SELECT 'ontario', outcome, lp, olp, dom, r FROM tagged
  )
  INSERT INTO public.listing_outcome_stats
    (region, outcome, homes, cut_share, median_cut_pct, ratio_sample, median_ratio, over10_share, median_dom, computed_at)
  SELECT
    region, outcome,
    count(*)::int,
    round(avg(CASE WHEN olp > lp THEN 1 ELSE 0 END) FILTER (WHERE olp >= 50000)::numeric, 3),
    round((percentile_cont(0.5) WITHIN GROUP (ORDER BY (olp - lp) / olp * 100) FILTER (WHERE olp > lp AND olp >= 50000))::numeric, 1),
    count(r)::int,
    round((percentile_cont(0.5) WITHIN GROUP (ORDER BY r))::numeric, 3),
    round(avg(CASE WHEN r > 1.10 THEN 1 ELSE 0 END) FILTER (WHERE r IS NOT NULL)::numeric, 3),
    round(percentile_cont(0.5) WITHIN GROUP (ORDER BY dom) FILTER (WHERE dom BETWEEN 0 AND 730))::int,
    now()
  FROM scoped
  GROUP BY region, outcome;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$function$;

-- ── Data API grants (REQUIRED since 2026-10-30) ─────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.listing_outcome_stats TO service_role;
REVOKE ALL ON FUNCTION public.refresh_listing_outcome_stats() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_listing_outcome_stats() TO service_role;
