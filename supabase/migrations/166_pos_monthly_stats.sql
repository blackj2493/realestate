-- 166: Power-of-sale sales BY MONTH, for the monthly Ontario Power of Sale Index
--      (/data/power-of-sale-index and its monthly editions).
--
-- WHY. pos_market_stats (164) holds only "last 12 months" and "the 12 before" per region.
-- A monthly index needs the count per calendar month: how many sales closed (firm) in the
-- month, and how many of them were power of sale. Same definitions as 164: a sale is
-- transaction_type 'For Sale', close_price >= 50000, dated by purchase_contract_date (the
-- deal date, not the scheduled closing); power of sale = a row in pos_sales (PublicRemarks
-- match). Regions: 'ontario' (all sales) + the 164 mapping (Toronto districts -> 'toronto',
-- Ottawa areas -> 'ottawa', else lower(city)).
--
-- Aggregates only reach the page (counts, shares, medians). Service role only.
-- Refresh: scripts/admin/refresh-pos-market.ts calls refresh_pos_monthly_stats() right after
-- refresh_pos_market_stats(), in the daily sync. NO pg_cron. Safe to re-run.

CREATE TABLE IF NOT EXISTS public.pos_monthly_stats (
  region      text    NOT NULL,
  month       date    NOT NULL,   -- first day of the month
  sales       integer NOT NULL,
  pos_sales   integer NOT NULL,
  pos_s2l     numeric,            -- median sale / final list price, %, power-of-sale sales
  other_s2l   numeric,            -- same, all other sales
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (region, month)
);
ALTER TABLE public.pos_monthly_stats ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.refresh_pos_monthly_stats()
RETURNS integer
LANGUAGE plpgsql
SET statement_timeout TO '180s'
AS $function$
DECLARE
  n integer;
BEGIN
  -- WHERE true: PostgREST runs pg_safeupdate, which rejects a bare DELETE from an RPC.
  DELETE FROM public.pos_monthly_stats WHERE true;

  WITH base AS (
    SELECT
      CASE
        WHEN s.city ~* '^toronto [cew][0-9]{2}$' THEN 'toronto'
        WHEN lower(s.city) IN (SELECT member_city FROM region_aliases WHERE region = 'ottawa') THEN 'ottawa'
        ELSE lower(s.city)
      END AS region,
      date_trunc('month', s.purchase_contract_date)::date AS month,
      (p.listing_key IS NOT NULL) AS is_pos,
      CASE WHEN s.list_price >= 50000 AND s.close_price::numeric / s.list_price BETWEEN 0.5 AND 2
           THEN s.close_price::numeric / s.list_price * 100 END AS s2l
    FROM raw_vow_sold s
    LEFT JOIN public.pos_sales p ON p.listing_key = s.listing_key
    WHERE s.transaction_type = 'For Sale'
      AND s.close_price >= 50000
      AND s.purchase_contract_date >= date_trunc('month', current_date - interval '25 months')
      AND s.purchase_contract_date <= current_date
      AND coalesce(s.city, '') <> ''
  ),
  scoped AS (
    SELECT region, month, is_pos, s2l FROM base
    UNION ALL
    SELECT 'ontario', month, is_pos, s2l FROM base
  )
  INSERT INTO public.pos_monthly_stats (region, month, sales, pos_sales, pos_s2l, other_s2l, computed_at)
  SELECT
    region, month,
    count(*)::int,
    count(*) FILTER (WHERE is_pos)::int,
    round((percentile_cont(0.5) WITHIN GROUP (ORDER BY s2l) FILTER (WHERE is_pos))::numeric, 1),
    round((percentile_cont(0.5) WITHIN GROUP (ORDER BY s2l) FILTER (WHERE NOT is_pos))::numeric, 1),
    now()
  FROM scoped
  GROUP BY region, month;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$function$;

-- ── Data API grants (REQUIRED since 2026-10-30) ─────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pos_monthly_stats TO service_role;
REVOKE ALL ON FUNCTION public.refresh_pos_monthly_stats() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_pos_monthly_stats() TO service_role;

COMMENT ON TABLE public.pos_monthly_stats IS
  'Power-of-sale vs all sales per region per calendar month (deal date), last ~25 months. Aggregates only. Rebuilt nightly by refresh_pos_monthly_stats().';

-- First fill, so the index page has data as soon as this is applied.
SELECT public.refresh_pos_monthly_stats();

INSERT INTO schema_migrations (filename, applied_via)
VALUES ('166_pos_monthly_stats.sql', 'sql-editor')
ON CONFLICT (filename) DO NOTHING;
