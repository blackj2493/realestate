-- 088 — region_aliases: make fragmented markets (Ottawa) roll up in SQL.
--
-- THE PROBLEM. Toronto and Ottawa are both "fragmented" markets, but for different reasons,
-- and only one of them is solvable with a pattern:
--   • Toronto stores the municipality as a PREFIX in a regular form ('Toronto C01',
--     'Toronto W08'), so `city ~ '^toronto [cwe][0-9][0-9]$'` rolls it up with no outside
--     knowledge. That is what every region RPC already does.
--   • Ottawa stores OREB AREA NAMES ('Barrhaven', 'Kanata', 'Ottawa Centre', 'Glebe -
--     Ottawa East and Area'). "Barrhaven" contains nothing linking it to Ottawa. No regex
--     can derive membership — it requires a LIST.
--
-- The consequence was silent and user-visible: region_listing_outcomes('Ottawa') matched
-- 9,937 SOLD rows (via the CountyOrParish branch, which only raw_vow_sold has) but ZERO
-- de-listed rows, so failed=0 → a fake 100% sell-through. The TS layer had to null it out
-- defensively. Same root cause blanked Ottawa's rental yield.
--
-- The list exists in the app (src/lib/dashboard/ottawaAreas.ts, 51 areas, used for Typesense
-- filtering) but has never been available to SQL. This table is that bridge — seeded from
-- the same TS constant by scripts/admin/seed-region-aliases.ts so there is one source of
-- truth, and reviewable/correctable in one place instead of buried in a query.
--
-- Both columns are stored LOWERCASE so the lookup is a direct comparison with no per-row
-- lower() on the alias side.
--
-- Run: npx tsx scripts/admin/applyMigrationFiles.ts 088_region_aliases.sql
--      npx tsx scripts/admin/seed-region-aliases.ts --apply

CREATE TABLE IF NOT EXISTS region_aliases (
  -- Canonical region as passed to the RPCs (p_region), lowercased. e.g. 'ottawa'
  region      text NOT NULL,
  -- A city/area value as stored in the feed, lowercased. e.g. 'barrhaven'
  member_city text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (region, member_city)
);

COMMENT ON TABLE region_aliases IS
  'Membership list for markets whose feed values cannot be pattern-matched to their municipality (Ottawa''s OREB area names). Seeded from src/lib/dashboard/ottawaAreas.ts by scripts/admin/seed-region-aliases.ts. Toronto/London do NOT need rows here — their district/directional forms are handled by regex in the RPCs.';

-- ── region_listing_outcomes: add the alias branch to all three CTEs ──────────────────
-- sold_addr already matched Ottawa via CountyOrParish; adding the alias branch there too
-- also picks up sold rows whose CountyOrParish is null but whose city is an OREB area.
CREATE OR REPLACE FUNCTION region_listing_outcomes(
  p_region   text,
  p_subtypes text[]  DEFAULT NULL,
  p_months   integer DEFAULT 12
)
RETURNS TABLE (
  window_months     integer,
  sold_count        integer,
  failed_count      integer,
  failure_rate      numeric,
  median_failed_dom integer
)
LANGUAGE sql
STABLE
SET statement_timeout = '60s'
AS $$
  WITH sold_addr AS (
    SELECT DISTINCT lower(trim(unparsed_address)) AS addr
    FROM raw_vow_sold
    WHERE (
        lower(city) = lower(p_region)
        OR lower(city_region) = lower(p_region)
        OR (lower(city) >= lower(p_region) || ' ' AND lower(city) < lower(p_region) || chr(33)
            AND lower(city) ~ ('^' || lower(p_region) || ' [cwe][0-9][0-9]$'))
        OR lower(raw_payload->>'CountyOrParish') = lower(p_region)
        OR lower(city) = ANY (ARRAY(SELECT member_city FROM region_aliases WHERE region = lower(p_region)))          -- 088
      )
      AND close_price >= 50000
      AND purchase_contract_date >= current_date - make_interval(months => p_months)
      AND (p_subtypes IS NULL OR property_sub_type = ANY (p_subtypes))
      AND unparsed_address IS NOT NULL AND trim(unparsed_address) <> ''
  ),
  active_addr AS (   -- currently on-market (relisted) — not a failure
    SELECT DISTINCT norm_address AS addr
    FROM listings
    WHERE (
        lower(city) = lower(p_region)
        OR lower(city_region) = lower(p_region)
        OR (lower(city) >= lower(p_region) || ' ' AND lower(city) < lower(p_region) || chr(33)
            AND lower(city) ~ ('^' || lower(p_region) || ' [cwe][0-9][0-9]$'))
        OR lower(city) = ANY (ARRAY(SELECT member_city FROM region_aliases WHERE region = lower(p_region)))          -- 088
      )
      AND list_price >= 50000
      AND norm_address IS NOT NULL AND norm_address <> ''
      AND coalesce(standard_status, '') NOT IN ('sold','closed','closed sale','leased','terminated','expired','suspended')
  ),
  del AS (
    SELECT lower(trim(unparsed_address)) AS addr, days_on_market::numeric AS dom
    FROM raw_vow_delisted
    WHERE (
        lower(city) = lower(p_region)
        OR lower(city_region) = lower(p_region)
        OR (lower(city) >= lower(p_region) || ' ' AND lower(city) < lower(p_region) || chr(33)
            AND lower(city) ~ ('^' || lower(p_region) || ' [cwe][0-9][0-9]$'))
        OR lower(city) = ANY (ARRAY(SELECT member_city FROM region_aliases WHERE region = lower(p_region)))          -- 088
      )
      AND delisted_date >= current_date - make_interval(months => p_months)
      AND lower(coalesce(transaction_type, '')) NOT LIKE '%lease%'   -- SALE only
      AND (p_subtypes IS NULL OR property_sub_type = ANY (p_subtypes))
      AND unparsed_address IS NOT NULL AND trim(unparsed_address) <> ''
  ),
  failed AS (
    SELECT d.addr, min(d.dom) AS dom
    FROM del d
    WHERE NOT EXISTS (SELECT 1 FROM sold_addr   s WHERE s.addr = d.addr)
      AND NOT EXISTS (SELECT 1 FROM active_addr a WHERE a.addr = d.addr)
    GROUP BY d.addr
  )
  SELECT
    p_months,
    (SELECT count(*)::int FROM sold_addr),
    (SELECT count(*)::int FROM failed),
    round((SELECT count(*)::numeric FROM failed)
          / NULLIF((SELECT count(*) FROM failed) + (SELECT count(*) FROM sold_addr), 0), 3),
    (SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY dom))::int FROM failed WHERE dom >= 0 AND dom <= 730);
$$;

COMMENT ON FUNCTION region_listing_outcomes(text, text[], integer) IS
  'Property-level SALE sell-through / withdrawal. Distinct SALE addresses that de-listed, never sold in-window, AND are not currently relisted, ÷ (those + distinct sold). Region: city/city_region/Toronto districts/CountyOrParish/region_aliases (088 — closes the Ottawa gap where delisted+listings lack CountyOrParish).';

-- ── region_rental_yield: add the alias branch to the rent CTE ────────────────────────
-- The price CTE already rolls Ottawa up via CountyOrParish; only the rent side (which reads
-- rental_market_index, keyed by OREB area name) was matching nothing.
CREATE OR REPLACE FUNCTION region_rental_yield(
  p_region   text,
  p_subtypes text[] DEFAULT NULL
)
RETURNS TABLE (
  beds            integer,
  typical_rent    integer,
  rent_sample     integer,
  median_price    bigint,
  price_sample    integer,
  gross_yield_pct numeric
)
LANGUAGE sql
STABLE
SET statement_timeout = '60s'
AS $$
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

COMMENT ON FUNCTION region_rental_yield(text, text[]) IS
  'Gross rental yield by bed count. Rent from rental_market_index (city/nbhd tier + Toronto district roll-up 085 + region_aliases 088 for Ottawa''s OREB area names), price from raw_vow_sold trailing 12mo. Scalars only (§6.3b).';
