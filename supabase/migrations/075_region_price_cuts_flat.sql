-- Migration 075: region_price_cuts reads the flat listings.total_price_drop (074).
--
-- Same body as the 073 version (property dedup + cut-% band) but `drop` comes from the
-- flat total_price_drop column instead of full_payload->>'total_price_drop' — no per-row
-- detoast, so Toronto drops from ~32s to sub-second. APPLY AFTER backfillTotalPriceDrop.ts.
-- COALESCE(total_price_drop, full_payload read) keeps it correct for any un-backfilled row.
--
-- Run: npx tsx scripts/admin/applyMigrationFiles.ts 075_region_price_cuts_flat.sql

CREATE OR REPLACE FUNCTION region_price_cuts(
  p_region text, p_subtypes text[] DEFAULT NULL, p_min_beds integer DEFAULT 0,
  p_min_baths numeric DEFAULT 0, p_min_parking integer DEFAULT 0,
  p_min_frontage numeric DEFAULT 0, p_basement text DEFAULT 'any'
)
RETURNS TABLE (active_count integer, cut_count integer, median_cut_amt integer, median_cut_pct numeric)
LANGUAGE sql STABLE SET statement_timeout = '60s'
AS $$
  WITH ranked AS (
    SELECT
      list_price,
      COALESCE(total_price_drop, NULLIF(full_payload->>'total_price_drop', '')::numeric) AS drop,
      row_number() OVER (PARTITION BY coalesce(nullif(property_hash, ''), nullif(norm_address, ''), listing_key)
                         ORDER BY last_seen_at DESC NULLS LAST, original_entry_timestamp DESC NULLS LAST, listing_key DESC) AS rn
    FROM listings
    WHERE (
        lower(city) = lower(p_region) OR lower(city_region) = lower(p_region)
        OR (lower(city) >= lower(p_region) || ' ' AND lower(city) < lower(p_region) || chr(33)
            AND lower(city) ~ ('^' || lower(p_region) || ' [cwe][0-9][0-9]$'))
        OR lower(full_payload->>'CountyOrParish') = lower(p_region))
      AND list_price >= 50000
      AND (p_subtypes IS NULL OR property_sub_type = ANY(p_subtypes))
      AND (p_min_beds     <= 0 OR COALESCE(bedrooms_total,          NULLIF(full_payload->>'BedroomsTotal', '')::numeric)         >= p_min_beds)
      AND (p_min_baths    <= 0 OR COALESCE(bathrooms_total_integer, NULLIF(full_payload->>'BathroomsTotalInteger', '')::numeric) >= p_min_baths)
      AND (p_min_parking  <= 0 OR COALESCE(parking_total,           NULLIF(full_payload->>'ParkingTotal', '')::numeric)          >= p_min_parking)
      AND (p_min_frontage <= 0 OR COALESCE(lot_width,               NULLIF(full_payload->>'LotWidth', '')::numeric)              >= p_min_frontage)
      AND (p_basement = 'any'
        OR (basement_tier IS NOT NULL AND ((p_basement='finished' AND basement_tier BETWEEN 1 AND 5) OR (p_basement='unfinished' AND basement_tier BETWEEN 6 AND 8)))
        OR (basement_tier IS NULL AND ((p_basement='finished' AND full_payload->'Basement' ?| array['Finished','Apartment','Finished with Walk-Out','Partially Finished']) OR (p_basement='unfinished' AND full_payload->'Basement' ? 'Unfinished'))))
      AND COALESCE(standard_status, lower(coalesce(full_payload->>'Status', full_payload->>'MlsStatus', full_payload->>'StandardStatus', '')))
          NOT IN ('sold','closed','closed sale','leased','terminated','expired','suspended')
  ),
  active AS (
    SELECT list_price, drop,
      (drop > 0 AND list_price > 0 AND (drop / (list_price + drop)) BETWEEN 0.005 AND 0.6) AS is_cut
    FROM ranked WHERE rn = 1
  )
  SELECT
    count(*)::int,
    count(*) FILTER (WHERE is_cut)::int,
    round(percentile_cont(0.5) WITHIN GROUP (ORDER BY drop) FILTER (WHERE is_cut))::int,
    round(percentile_cont(0.5) WITHIN GROUP (ORDER BY (drop / (list_price + drop) * 100)) FILTER (WHERE is_cut)::numeric, 1)
  FROM active;
$$;

COMMENT ON FUNCTION region_price_cuts(text, text[], integer, numeric, integer, numeric, text) IS
  'Price-cut pressure, deduped by property (073), flat total_price_drop (074/075 — no detoast), cut-% banded 0.5-60%. COALESCE→full_payload for un-backfilled rows.';
