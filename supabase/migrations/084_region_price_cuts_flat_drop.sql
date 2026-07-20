-- 084 — region_price_cuts: read the flat `total_price_drop` column instead of
-- detoasting full_payload->>'total_price_drop'.
--
-- WHY: the 082 body projected `NULLIF(full_payload->>'total_price_drop','')::numeric`
-- for EVERY row in the `ranked` CTE (before the rn=1/freshness filter), forcing a
-- full_payload detoast across the whole matched set. For Toronto (~10.7k fresh actives,
-- many more pre-dedup rows) that pushed the RPC to ~35s standalone and made it lose to
-- contention during the 11-RPC region_metrics refresh batch, returning cuts=null for the
-- flagship market on both /analytics and the public /data price-cut tracker.
--
-- The flat `listings.total_price_drop` column is already maintained by the sync and is
-- byte-identical to the payload value (verified: Toronto flat>0 count == payload>0 count),
-- so this is a pure speedup — same numbers, no detoast. Every other clause already prefers
-- flat columns (standard_status, bedrooms_total, …); this closes the last hot-path detoast.
-- Signature unchanged.

CREATE OR REPLACE FUNCTION region_price_cuts(
  p_region text, p_subtypes text[] DEFAULT NULL, p_min_beds integer DEFAULT 0,
  p_min_baths numeric DEFAULT 0, p_min_parking integer DEFAULT 0,
  p_min_frontage numeric DEFAULT 0, p_basement text DEFAULT 'any'
)
RETURNS TABLE (active_count integer, cut_count integer, median_cut_amt integer, median_cut_pct numeric)
LANGUAGE sql STABLE SET statement_timeout = '90s'
AS $$
  WITH ranked AS (
    SELECT
      last_seen_at,
      list_price,
      total_price_drop AS drop,   -- 084: flat column (was full_payload->>'total_price_drop')
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
      AND (last_seen_at IS NULL OR last_seen_at >= now() - interval '30 days')
  )
  SELECT
    count(*)::int,
    count(*) FILTER (WHERE is_cut)::int,
    round(percentile_cont(0.5) WITHIN GROUP (ORDER BY drop) FILTER (WHERE is_cut))::int,
    round(percentile_cont(0.5) WITHIN GROUP (ORDER BY (drop / (list_price + drop) * 100)) FILTER (WHERE is_cut)::numeric, 1)
  FROM active;
$$;

COMMENT ON FUNCTION region_price_cuts(text, text[], integer, numeric, integer, numeric, text) IS
  'Price-cut pressure for one market area: active_count, cut_count, median $ and % cut depth among reduced listings. Reads flat total_price_drop (084) — no full_payload detoast on the hot path. Same active-set scoping + 30d freshness gate as region_active_aggregates (082). Scalars only (§6.3b).';
