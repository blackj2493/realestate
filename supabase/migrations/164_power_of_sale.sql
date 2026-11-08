-- 164: Power-of-sale sales and market stats, for the /power-of-sale pages.
--
-- WHY. "power of sale" searches in Ontario are ~5-8x their 2022 level (Google Trends,
-- 2026-11-08), and the searches are city lists ("power of sale homes brampton / vaughan").
-- The pages list today's power-of-sale homes (Typesense description_signals, IDX) and
-- state how power-of-sale SALES compare with other sales. That needs the sales flagged.
--
-- HOW. A sale is power of sale when its PublicRemarks say so (same family of phrases as
-- the site's power_of_sale description signal: power of sale, foreclosure, bank-owned,
-- court-ordered, receivership). The remarks live only in raw_vow_sold.raw_payload, and a
-- regex over the detoasted payload costs ~12s per month of sales (measured 2026-11-08) and
-- timed out at 170s over 2 years. So the flag is computed ONCE per sale and kept in a
-- narrow table, pos_sales (only the matches, ~0.3-0.5% of sales):
--   refresh_pos_sales(from, to)     -- re-flags one contract-date window (nightly: 45 days;
--                                      one-time backfill: month by month, 25 months)
--   refresh_pos_market_stats()      -- rebuilds pos_market_stats from FLAT columns + the
--                                      flags: last 12 months vs the 12 before, per region
-- Regions: Toronto districts ("Toronto C01") roll up to 'toronto', Ottawa areas through
-- region_aliases 'ottawa', every other city is lower(city); 'ontario' = all sales.
--
-- Aggregates only reach the page (counts, shares, medians). Service role only.
-- Refresh: scripts/admin/refresh-pos-market.ts, a step in daily-sync.yml. NO pg_cron.
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS public.pos_sales (
  listing_key       text PRIMARY KEY,
  city              text,
  city_region       text,
  contract_date     date NOT NULL,
  close_price       numeric,
  list_price        numeric,
  dom               integer,
  property_sub_type text,
  flagged_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pos_sales_contract_date_idx ON public.pos_sales (contract_date);
ALTER TABLE public.pos_sales ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.pos_market_stats (
  region            text NOT NULL,
  period            text NOT NULL CHECK (period IN ('12m', 'prev12m')),
  sales             integer NOT NULL,
  pos_sales         integer NOT NULL,
  pos_s2l           numeric,   -- median sale / final list price, %, power-of-sale sales
  other_s2l         numeric,   -- same, all other sales
  pos_below_share   numeric,   -- share (0..1) sold below the final list price
  other_below_share numeric,
  pos_dom           integer,   -- median days on market
  other_dom         integer,
  computed_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (region, period)
);
ALTER TABLE public.pos_market_stats ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.refresh_pos_sales(p_from date, p_to date)
RETURNS integer
LANGUAGE plpgsql
SET statement_timeout TO '180s'
AS $function$
DECLARE
  n integer;
BEGIN
  DELETE FROM public.pos_sales WHERE contract_date >= p_from AND contract_date < p_to;
  INSERT INTO public.pos_sales (listing_key, city, city_region, contract_date, close_price, list_price, dom, property_sub_type, flagged_at)
  SELECT listing_key, city, city_region, purchase_contract_date, close_price, list_price,
         COALESCE(days_on_market,
                  CASE WHEN listing_contract_date IS NOT NULL
                       THEN GREATEST(0, purchase_contract_date - listing_contract_date) END),
         property_sub_type, now()
  FROM raw_vow_sold
  WHERE transaction_type = 'For Sale'
    AND close_price >= 50000
    AND purchase_contract_date >= p_from AND purchase_contract_date < p_to
    AND raw_payload->>'PublicRemarks' ~* '(power\s+of\s+sale|foreclos|bank[\s-]+owned|court[\s-]+ordered|receivership)'
    AND raw_payload->>'PublicRemarks' !~* '(not|no)\s+(an?\s+)?(power\s+of\s+sale|foreclosure)'
  ON CONFLICT (listing_key) DO UPDATE SET
    city = EXCLUDED.city, city_region = EXCLUDED.city_region, contract_date = EXCLUDED.contract_date,
    close_price = EXCLUDED.close_price, list_price = EXCLUDED.list_price, dom = EXCLUDED.dom,
    property_sub_type = EXCLUDED.property_sub_type, flagged_at = now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$function$;

CREATE OR REPLACE FUNCTION public.refresh_pos_market_stats()
RETURNS integer
LANGUAGE plpgsql
SET statement_timeout TO '180s'
AS $function$
DECLARE
  n integer;
BEGIN
  -- WHERE true: PostgREST runs pg_safeupdate, which rejects a bare DELETE from an RPC.
  DELETE FROM public.pos_market_stats WHERE true;

  WITH base AS (
    SELECT
      CASE
        WHEN s.city ~* '^toronto [cew][0-9]{2}$' THEN 'toronto'
        WHEN lower(s.city) IN (SELECT member_city FROM region_aliases WHERE region = 'ottawa') THEN 'ottawa'
        ELSE lower(s.city)
      END AS region,
      CASE WHEN s.purchase_contract_date > current_date - interval '12 months' THEN '12m' ELSE 'prev12m' END AS period,
      (p.listing_key IS NOT NULL) AS is_pos,
      CASE WHEN s.list_price >= 50000 AND s.close_price::numeric / s.list_price BETWEEN 0.5 AND 2
           THEN s.close_price::numeric / s.list_price * 100 END AS s2l,
      COALESCE(s.days_on_market,
               CASE WHEN s.listing_contract_date IS NOT NULL
                    THEN GREATEST(0, s.purchase_contract_date - s.listing_contract_date) END) AS dom
    FROM raw_vow_sold s
    LEFT JOIN public.pos_sales p ON p.listing_key = s.listing_key
    WHERE s.transaction_type = 'For Sale'
      AND s.close_price >= 50000
      AND s.purchase_contract_date > current_date - interval '24 months'
      AND s.purchase_contract_date <= current_date
      AND coalesce(s.city, '') <> ''
  ),
  scoped AS (
    SELECT region, period, is_pos, s2l, dom FROM base
    UNION ALL
    SELECT 'ontario', period, is_pos, s2l, dom FROM base
  )
  INSERT INTO public.pos_market_stats
    (region, period, sales, pos_sales, pos_s2l, other_s2l, pos_below_share, other_below_share, pos_dom, other_dom, computed_at)
  SELECT
    region, period,
    count(*)::int,
    count(*) FILTER (WHERE is_pos)::int,
    round((percentile_cont(0.5) WITHIN GROUP (ORDER BY s2l) FILTER (WHERE is_pos))::numeric, 1),
    round((percentile_cont(0.5) WITHIN GROUP (ORDER BY s2l) FILTER (WHERE NOT is_pos))::numeric, 1),
    round(avg(CASE WHEN s2l < 100 THEN 1 ELSE 0 END) FILTER (WHERE is_pos AND s2l IS NOT NULL), 3),
    round(avg(CASE WHEN s2l < 100 THEN 1 ELSE 0 END) FILTER (WHERE NOT is_pos AND s2l IS NOT NULL), 3),
    round(percentile_cont(0.5) WITHIN GROUP (ORDER BY dom) FILTER (WHERE is_pos AND dom BETWEEN 0 AND 730))::int,
    round(percentile_cont(0.5) WITHIN GROUP (ORDER BY dom) FILTER (WHERE NOT is_pos AND dom BETWEEN 0 AND 730))::int,
    now()
  FROM scoped
  GROUP BY region, period;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$function$;

-- ── Data API grants (REQUIRED since 2026-10-30) ─────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pos_sales TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pos_market_stats TO service_role;
REVOKE ALL ON FUNCTION public.refresh_pos_sales(date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_pos_market_stats() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_pos_sales(date, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_pos_market_stats() TO service_role;

COMMENT ON TABLE public.pos_sales IS
  'Power-of-sale SALES (PublicRemarks match, flagged once per sale). Narrow cache so the stats never regex raw_payload. Filled by refresh_pos_sales(from, to).';
COMMENT ON TABLE public.pos_market_stats IS
  'Power-of-sale vs other sales per region, last 12 months and the 12 before. Aggregates only. Rebuilt nightly by refresh_pos_market_stats().';

INSERT INTO schema_migrations (filename, applied_via)
VALUES ('164_power_of_sale.sql', 'sql-editor')
ON CONFLICT (filename) DO NOTHING;
