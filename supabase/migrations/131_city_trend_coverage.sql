-- 131_city_trend_coverage.sql
--
-- Canary RPC for the data-health check `city-trend-coverage`: which cities carry real
-- inventory but have NO row at all in avm_trend_index?
--
-- THE FAILURE THIS EXISTS TO CATCH. On 2026-08-29 the AVM priced 1,292 of 1,292 active
-- Kitchener listings and returned a value for 1,291 of them. Nothing looked broken. But
-- Kitchener had 2,020 Detached sales in the trailing window and ZERO trend rows: every one
-- of its sales was dropped before aggregation, because refresh-avm-trend-offset.ts skips
-- any sold row whose (city_region × sub-type) has no avm_multiplier_matrix cohort — and
-- that skip also removes the row from the CITY trend g(city, sub, period), which never
-- needed a community key. Two routes in:
--
--   1. the sold feed ships a blank CityRegion — all of Waterloo Region and Brantford,
--      9,960 of the 10,681 dropped sales;
--   2. CityRegion is present but every community is too thin to train a matrix —
--      Chatham-Kent spreads 200 sales across 26 communities, so none qualifies.
--
-- The estimates were real numbers computed with no time trend. The only visible trace was
-- that not one listing in those cities ever reached HIGH confidence, against 33% of the
-- rest of the book. An output-only check cannot see this: the output is still plausible.
-- This measures the INPUT.
--
-- EVERY predicate list arrives as a parameter — terminal statuses, unpriceable subtypes —
-- so this function holds NO copy of any of them. Same reasoning as migration 113:
-- normalizeType.ts exports UNPRICEABLE_EXACT / UNPRICEABLE_PATTERNS precisely so the canary
-- can pass the canonical values, and a list duplicated here would re-create the drift.
--
-- COST: measured 4.3s cold / 4.5s warm on prod against a 3.9 GB listings table — one grouped
-- scan of flat columns (no TOAST) plus a small lateral count per city. That fits the 8s
-- PostgREST budget, but only just, so it carries its own statement_timeout the way migration
-- 126 does. If it ever slows, index the scan rather than raising the timeout.
--
-- SECURITY: SECURITY INVOKER + STABLE, EXECUTE to service_role only — same as 113/126.

CREATE OR REPLACE FUNCTION public.city_trend_coverage(
  p_min_actives integer,
  p_terminal    text[],
  p_exact       text[],
  p_patterns    text[]
)
RETURNS TABLE (city text, active_listings integer, trend_rows integer, newest_period date)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
SET statement_timeout = '45s'
AS $$
  WITH live AS (
    SELECT btrim(l.city) AS city, count(*)::int AS n
    FROM public.listings l
    WHERE l.city IS NOT NULL
      AND btrim(l.city) <> ''
      AND l.list_price >= 50000
      AND l.standard_status IS NOT NULL
      AND l.standard_status <> ALL (p_terminal)
      -- Only types the AVM will actually price; a city of vacant land needs no trend.
      AND NOT (
        lower(btrim(l.property_sub_type)) = ANY (p_exact)
        OR EXISTS (
          SELECT 1 FROM unnest(p_patterns) AS p
          WHERE lower(btrim(l.property_sub_type)) LIKE '%' || p || '%'
        )
      )
    GROUP BY 1
    HAVING count(*) >= p_min_actives
  )
  SELECT live.city,
         live.n,
         COALESCE(t.rows, 0)::int,
         t.newest
  FROM live
  LEFT JOIN LATERAL (
    SELECT count(*)::int AS rows, max(ti.period_end)::date AS newest
    FROM public.avm_trend_index ti
    WHERE lower(btrim(ti.city)) = lower(live.city)
  ) t ON true
  ORDER BY live.n DESC
$$;

COMMENT ON FUNCTION public.city_trend_coverage(integer, text[], text[], text[]) IS
  'Data-health canary: cities with >= p_min_actives priceable active listings, and how many '
  'rows each has in avm_trend_index. Zero rows means the AVM prices that city with no time '
  'trend while still returning plausible numbers. Predicate lists are parameters — the '
  'canonical copies live in src/lib/avm/normalizeType.ts. SECURITY INVOKER — service_role only.';

REVOKE ALL ON FUNCTION public.city_trend_coverage(integer, text[], text[], text[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.city_trend_coverage(integer, text[], text[], text[])
  TO service_role;
