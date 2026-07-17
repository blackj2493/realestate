-- Migration 065: region_seasonality — best month to buy / sell, from sold history.
--
-- For each calendar month (1–12), across the last 5 years of raw_vow_sold: sales volume,
-- a YEAR-NORMALIZED price index (each sale ÷ its own year's median, so a rising market
-- doesn't make summer look "expensive"), and sold-to-list strength. price_index_pct > 0 =
-- homes that month sold above their year's median (seller-favourable → good to SELL);
-- < 0 = below (good to BUY). Flat columns only — NO full_payload detoast, so this is fast
-- even for Toronto. Same region match as region_price_trend (059). raw_vow_sold read-only.
--
-- Run: npx tsx scripts/admin/applyMigrationFiles.ts 065_region_seasonality.sql

CREATE OR REPLACE FUNCTION region_seasonality(
  p_region   text,
  p_subtypes text[] DEFAULT NULL
)
RETURNS TABLE (
  month_num       integer,
  sales           integer,
  price_index_pct numeric,  -- median (sale ÷ year-median) − 1, as %
  sold_to_list    numeric
)
LANGUAGE sql
STABLE
SET statement_timeout = '60s'
AS $$
  WITH base AS (
    SELECT
      close_price::numeric                        AS price,
      list_price::numeric                         AS list,
      EXTRACT(month FROM purchase_contract_date)::int AS mon,
      EXTRACT(year  FROM purchase_contract_date)::int AS yr
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
      )
      AND close_price >= 50000
      AND purchase_contract_date >= current_date - interval '5 years'
      AND (p_subtypes IS NULL OR property_sub_type = ANY (p_subtypes))
  ),
  yearmed AS (
    SELECT yr, percentile_cont(0.5) WITHIN GROUP (ORDER BY price) AS med
    FROM base GROUP BY yr
  ),
  norm AS (
    SELECT b.mon, b.list, b.price / y.med AS rel, b.price / NULLIF(b.list, 0) AS s2l
    FROM base b JOIN yearmed y ON y.yr = b.yr
    WHERE y.med > 0
  )
  SELECT
    mon,
    count(*)::int,
    round(((percentile_cont(0.5) WITHIN GROUP (ORDER BY rel))::numeric - 1) * 100, 1),
    round((avg(s2l) FILTER (WHERE list >= 50000 AND s2l > 0.5 AND s2l < 2) * 100)::numeric, 1)
  FROM norm
  GROUP BY mon
  ORDER BY mon;
$$;

COMMENT ON FUNCTION region_seasonality(text, text[]) IS
  'Monthly (1–12) seasonality over the last 5 years of raw_vow_sold: sales volume, year-normalized price index (median sale ÷ year-median − 1, %), and sold-to-list. Flat columns only (no detoast). Same region match as region_price_trend (059).';
