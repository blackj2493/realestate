-- 163: Market facts per TRREB community, for the neighbourhood hub pages
-- (/property/{prov}/{city}/{neighbourhood}).
--
-- WHY. The city hubs got a citable "housing market facts" block (PR #673) from the
-- region_metrics precompute, which covers only the 15 board markets. The ~1,000
-- neighbourhood hubs list homes and census facts but no market numbers, and the numbers
-- are what AI assistants and searchers quote. This precomputes the same definitions per
-- community, in ONE grouped pass per night, so the page reads one row and runs no
-- aggregate at request time.
--
-- DEFINITIONS (identical to the region RPCs, migration 153):
--   sold side, last 12 months, raw_vow_sold, transaction_type 'For Sale', close >= $50k:
--     under_ask_share / ask_gap_median  — vs OriginalListPrice, gap band ±60%
--                                          (region_sold_dynamics).
--     median_dom                        — board DaysOnMarket, else contract-date span,
--                                          band 0..730 (region_sold_dynamics). FLAT columns
--                                          only: no raw_payload fallback, so no detoast.
--     median_price                      — median close price, all home types.
--   active side, listings, deduped per property, feed-verified live (region_price_cuts):
--     cut_share / median_cut_pct        — total_price_drop vs the price before the cuts,
--                                          band 0.5%..60%.
--     median_true_dom                   — flat listings.true_dom (relists joined; the
--                                          nightly re-floor keeps it current).
--
-- Aggregates only (counts, shares, medians) — the same category as the /data trackers.
-- The page drops any fact whose sample is thin (src/lib/data/communityFacts.ts).
--
-- Who reads and writes it: service role only (the nightly refresh + the hub page).
-- Refresh: scripts/admin/refresh-community-facts.ts, a step in daily-sync.yml. NO pg_cron.
--
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS public.community_market_facts (
  city             text NOT NULL,
  city_region      text NOT NULL,
  sales_12m        integer NOT NULL DEFAULT 0,
  median_price     integer,
  gap_sample       integer NOT NULL DEFAULT 0,
  under_ask_share  numeric,
  ask_gap_median   numeric,
  dom_sample       integer NOT NULL DEFAULT 0,
  median_dom       integer,
  active_count     integer NOT NULL DEFAULT 0,
  cut_share        numeric,
  median_cut_pct   numeric,
  median_true_dom  integer,
  computed_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (city, city_region)
);

ALTER TABLE public.community_market_facts ENABLE ROW LEVEL SECURITY;

-- Rebuilds the whole table in one transaction (DELETE + INSERT): a reader sees the old
-- night or the new night, never half. SET statement_timeout lives IN the definition: the
-- service role's 8s default would kill the ~6s active pass on a busy night, and a later
-- CREATE OR REPLACE without this clause would silently drop it.
CREATE OR REPLACE FUNCTION public.refresh_community_market_facts()
RETURNS integer
LANGUAGE plpgsql
SET statement_timeout TO '180s'
AS $function$
DECLARE
  n integer;
BEGIN
  -- WHERE true: PostgREST runs pg_safeupdate, which rejects a bare DELETE from an RPC.
  DELETE FROM public.community_market_facts WHERE true;

  WITH sold AS (
    SELECT city, city_region,
           close_price::numeric AS price,
           original_list_price::numeric AS olp,
           COALESCE(days_on_market,
                    CASE WHEN listing_contract_date IS NOT NULL
                         THEN GREATEST(0, purchase_contract_date - listing_contract_date) END) AS dom
    FROM raw_vow_sold
    WHERE transaction_type = 'For Sale'
      AND close_price >= 50000
      AND purchase_contract_date >= current_date - interval '12 months'
      AND purchase_contract_date <= current_date
      AND coalesce(city, '') <> ''
      AND coalesce(city_region, '') <> ''
  ),
  s AS (
    SELECT city, city_region,
      count(*)::int AS sales_12m,
      round(percentile_cont(0.5) WITHIN GROUP (ORDER BY price))::int AS median_price,
      count(*) FILTER (WHERE olp > 50000 AND (price - olp) / olp BETWEEN -0.6 AND 0.6)::int AS gap_sample,
      round(avg(CASE WHEN price < olp THEN 1 ELSE 0 END)
            FILTER (WHERE olp > 50000 AND (price - olp) / olp BETWEEN -0.6 AND 0.6), 3) AS under_ask_share,
      round((percentile_cont(0.5) WITHIN GROUP (ORDER BY (price - olp) / olp)
            FILTER (WHERE olp > 50000 AND (price - olp) / olp BETWEEN -0.6 AND 0.6) * 100)::numeric, 1) AS ask_gap_median,
      count(*) FILTER (WHERE dom BETWEEN 0 AND 730)::int AS dom_sample,
      round(percentile_cont(0.5) WITHIN GROUP (ORDER BY dom) FILTER (WHERE dom BETWEEN 0 AND 730))::int AS median_dom
    FROM sold
    GROUP BY 1, 2
  ),
  ranked AS (
    SELECT city, city_region, last_seen_at, list_price, total_price_drop AS drop, true_dom,
      row_number() OVER (PARTITION BY coalesce(nullif(property_hash, ''), nullif(norm_address, ''), listing_key)
                         ORDER BY last_seen_at DESC NULLS LAST, original_entry_timestamp DESC NULLS LAST, listing_key DESC) AS rn
    FROM listings
    WHERE list_price >= 50000
      AND coalesce(city, '') <> ''
      AND coalesce(city_region, '') <> ''
      AND standard_status NOT IN ('sold','closed','closed sale','leased','terminated','expired','suspended')
  ),
  active AS (
    SELECT city, city_region, true_dom,
      CASE WHEN drop > 0 AND list_price > 0 AND (drop / (list_price + drop)) BETWEEN 0.005 AND 0.6
           THEN drop / (list_price + drop) * 100 END AS cut_pct
    FROM ranked
    WHERE rn = 1
      AND COALESCE(last_seen_at, '-infinity'::timestamptz) >= public.feed_liveness_floor()
  ),
  a AS (
    SELECT city, city_region,
      count(*)::int AS active_count,
      round(avg(CASE WHEN cut_pct IS NOT NULL THEN 1 ELSE 0 END), 3) AS cut_share,
      round(percentile_cont(0.5) WITHIN GROUP (ORDER BY cut_pct)::numeric, 1) AS median_cut_pct,
      round(percentile_cont(0.5) WITHIN GROUP (ORDER BY true_dom) FILTER (WHERE true_dom >= 0))::int AS median_true_dom
    FROM active
    GROUP BY 1, 2
  )
  INSERT INTO public.community_market_facts
    (city, city_region, sales_12m, median_price, gap_sample, under_ask_share, ask_gap_median,
     dom_sample, median_dom, active_count, cut_share, median_cut_pct, median_true_dom, computed_at)
  SELECT
    coalesce(s.city, a.city), coalesce(s.city_region, a.city_region),
    coalesce(s.sales_12m, 0), s.median_price, coalesce(s.gap_sample, 0), s.under_ask_share, s.ask_gap_median,
    coalesce(s.dom_sample, 0), s.median_dom,
    coalesce(a.active_count, 0), a.cut_share, a.median_cut_pct, a.median_true_dom,
    now()
  FROM s
  FULL JOIN a ON a.city = s.city AND a.city_region = s.city_region;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$function$;

-- ── Data API grants (REQUIRED since 2026-10-30) ─────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.community_market_facts TO service_role;
REVOKE ALL ON FUNCTION public.refresh_community_market_facts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_community_market_facts() TO service_role;

COMMENT ON TABLE public.community_market_facts IS
  'Market facts per TRREB community (City + CityRegion): 12-month sold side and the live active side, same definitions as the region RPCs (153). Aggregates only. Rebuilt nightly by refresh_community_market_facts() from daily-sync.yml.';

INSERT INTO schema_migrations (filename, applied_via)
VALUES ('163_community_market_facts.sql', 'sql-editor')
ON CONFLICT (filename) DO NOTHING;
