-- 157_region_price_cut_outcomes.sql
--
-- What a price cut cost sellers in one area: sold houses grouped by how far the asking
-- price was cut before the sale, with the sold price as a share of the FIRST asking price
-- and the days on market for each group. Powers the "The cost of a price cut" panel on
-- /analytics, which the monthly Street Recap links to from "If you ever sell".
--
-- VOW. Every figure here comes from sold prices, so it is shown only to a signed-in reader
-- who accepted the terms (the route returns a locked shape otherwise) and NEVER printed in
-- an email (VOW Agreement §(f)). The recap email links to the panel; it does not quote it.
--
-- WHAT COUNTS AS A CUT. list_price (the last ask) below original_list_price (the first ask)
-- OF THE SAME LISTING. A seller who withdraws and relists lower starts a new listing with a
-- new original price, so that cut is not seen here — the groups understate cuts, never
-- invent them.
--
-- GROUPS. none / under5 / 5to10 / over10 / and 5plus (the union of the last two), so the
-- panel can fall back to three groups where the deep cuts are too few to show alone. Each
-- row carries its count; the panel hides any group under its minimum, the RPC does not.
--
-- BANDS. close / first ask between 0.5 and 1.6 drops typos and mis-keyed prices (a $1 list
-- or a lease keyed as a sale); dom 0..730 matches region_sold_dynamics.
--
-- Region matching is the same as region_sold_dynamics after 153 (aliases, Toronto district
-- codes), except that the CountyOrParish fallback runs only for a region the flat columns
-- do not match at all — see the note in the WHERE clause.

CREATE OR REPLACE FUNCTION public.region_price_cut_outcomes(
  p_region   text,
  p_subtypes text[]  DEFAULT NULL::text[],
  p_months   integer DEFAULT 12
)
 RETURNS TABLE(bucket text, sales integer, pct_of_first_ask numeric, median_dom integer,
               median_first_ask integer)
 LANGUAGE sql
 STABLE
 SET statement_timeout TO '60s'
AS $function$
  WITH base AS (
    SELECT
      close_price::numeric AS price,
      list_price::numeric  AS ask,
      COALESCE(original_list_price, NULLIF(raw_payload->>'OriginalListPrice', '')::numeric) AS olp,
      COALESCE(
        days_on_market,
        CASE WHEN listing_contract_date IS NOT NULL
             THEN GREATEST(0, purchase_contract_date - listing_contract_date)
             ELSE NULL END
      ) AS dom
    FROM raw_vow_sold
    WHERE (
        lower(city) = lower(p_region)
        OR lower(city_region) = lower(p_region)
        OR lower(city) = ANY (ARRAY(SELECT member_city FROM region_aliases WHERE region = lower(p_region)))
        OR (
          lower(city) >= lower(p_region) || ' '
          AND lower(city) <  lower(p_region) || chr(33)
          AND lower(city) ~ ('^' || lower(p_region) || ' [cwe][0-9][0-9]$')
        )
        -- The CountyOrParish fallback detoasts raw_payload for EVERY sale in the window
        -- (52s for Toronto, measured 2026-10-23). It runs only when the flat columns match
        -- nothing at all: the uncorrelated EXISTS below is evaluated once, as an InitPlan.
        OR (
          NOT EXISTS (
            SELECT 1 FROM raw_vow_sold f
            WHERE f.transaction_type = 'For Sale'
              AND f.purchase_contract_date >= (current_date - make_interval(months => p_months))
              AND (lower(f.city) = lower(p_region)
                OR lower(f.city_region) = lower(p_region)
                OR lower(f.city) = ANY (ARRAY(SELECT member_city FROM region_aliases WHERE region = lower(p_region)))
                OR lower(f.city) ~ ('^' || lower(p_region) || ' [cwe][0-9][0-9]$'))
          )
          AND lower(raw_payload->>'CountyOrParish') = lower(p_region)
        )
      )
      AND transaction_type = 'For Sale'
      AND close_price >= 50000
      AND list_price > 0
      AND purchase_contract_date >= (current_date - make_interval(months => p_months))
      AND (p_subtypes IS NULL OR property_sub_type = ANY (p_subtypes))
  ),
  graded AS (
    SELECT price, olp, dom,
      CASE WHEN ask >= olp              THEN 'none'
           WHEN (olp - ask) / olp < 0.05 THEN 'under5'
           WHEN (olp - ask) / olp < 0.10 THEN '5to10'
           ELSE 'over10' END AS g
    FROM base
    WHERE olp > 0 AND price / olp BETWEEN 0.5 AND 1.6
  ),
  tagged AS (
    SELECT g AS bucket, price, olp, dom FROM graded
    UNION ALL
    SELECT '5plus', price, olp, dom FROM graded WHERE g IN ('5to10', 'over10')
  )
  SELECT
    bucket,
    count(*)::int,
    round((percentile_cont(0.5) WITHIN GROUP (ORDER BY price / olp))::numeric * 100, 1),
    (percentile_cont(0.5) WITHIN GROUP (ORDER BY dom) FILTER (WHERE dom BETWEEN 0 AND 730))::int,
    (percentile_cont(0.5) WITHIN GROUP (ORDER BY olp))::int
  FROM tagged
  GROUP BY bucket
  ORDER BY array_position(ARRAY['none', 'under5', '5to10', 'over10', '5plus'], bucket);
$function$;

-- From 2026-10-30 new objects get no API grants by default (#635); the route calls this
-- with the service role. Sold aggregates are never granted to anon or authenticated.
REVOKE ALL ON FUNCTION public.region_price_cut_outcomes(text, text[], integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.region_price_cut_outcomes(text, text[], integer) TO service_role;
