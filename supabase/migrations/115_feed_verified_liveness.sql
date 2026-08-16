-- 115_feed_verified_liveness.sql
--
-- Adopts FEED-VERIFIED liveness in region_active_aggregates and region_price_cuts.
--
-- WHY
-- ---
-- `listings.last_seen_at` was a row-CREATION timestamp (default now(), no trigger,
-- 174,544/174,544 values equal created_at) because the ghostReconcile heartbeat that
-- was supposed to stamp it had never once succeeded: its single ~95k-row UPDATE hit the
-- statement timeout, and the workflow's `| tee` pipeline swallowed the failure. Both are
-- fixed in #343, and the column has now been seeded from a live feed snapshot (94,590
-- rows stamped 2026-08-13), so it finally means "present in the feed".
--
-- Scored row-by-row against that snapshot (112,676 Active keys; only 67,182 of our
-- 124,260 non-terminal listings are genuinely live):
--
--   definition                keeps    live   precision  recall
--   last_seen gate (old)     73,966  39,729     53.7%    59.1%   <- worse than no gate
--   no gate                 124,260  67,182     54.1%   100.0%
--   campaign-Active          96,938  64,241     66.3%    95.6%
--   FEED-VERIFIED (this)    ~94,590    ~all     ~100%    ~100%
--
-- The old gate was worse than no gate on BOTH axes: it discarded 41% of genuinely live
-- listings while admitting 34,237 ghosts. It looked "roughly right" only because the
-- SHARE it kept (59.5%) resembled the true share (54.1%) -- the rows it chose were
-- near-random. Matching an aggregate proportion is not row-level accuracy.
--
-- Verified before shipping: both functions land within 2 listings of the feed-verified
-- count in Toronto (10,039 vs 10,041), Ottawa (3,813 vs 3,813) and Hamilton (2,103 vs
-- 2,103), in 172-4,721ms.
--
-- The Price-Cut Tracker is the one materially affected surface: its denominator was
-- biased toward recently-CREATED listings -- the least likely to have cut yet -- so the
-- published cut share was systematically understated. Corrected: Toronto 22.0%,
-- Ottawa 24.1%, Hamilton 26.4%.
--
-- THE GATE
-- --------
-- Measured against the last SWEEP, not against now(), so it stays correct in the days
-- between weekly heartbeats. Two safety properties:
--   * FAIL-OPEN -- no stamps at all, or a newest stamp older than 21d (heartbeat
--     broken), yields '-infinity' and the gate admits everything rather than emptying
--     every surface. This matters: the heartbeat just proved it can fail silently.
--   * Rows created since the last sweep keep the column default (now()) and therefore
--     pass, so a brand-new listing is never dropped for not yet having been swept.
-- Written as ONE index-backed scalar subquery (`ORDER BY ... LIMIT 1`, not max(), which
-- was choosing a 250ms Seq Scan): three separate CTE references became InitPlans only
-- when the planner saw literals, and degraded badly when called through the RPC's
-- parameters.
--
-- NOT INCLUDED: region_dom_distribution. The same gate produces correct feed-verified
-- numbers there (Hamilton 48->71d matches ground truth exactly) but is 5-8x SLOWER than
-- the deployed migration 114 while processing FEWER rows, and Toronto exceeds the 90s
-- statement_timeout. Four placements of the threshold subquery all regressed it, and
-- creating idx_listings_last_seen did not help. It stays on 114 until that is understood
-- -- so /data/days-on-market keeps publishing inflated ABSOLUTES (Toronto 71->92d vs a
-- feed-verified 44->65d). Its "Hidden Days" column remains correct at ~21d, because
-- ghosts shift both clocks by the same offset.
--
-- ALSO NOT FIXED (separate bug, same family): region_active_aggregates still derives
-- stale_count from GREATEST(true_dom, naive_age) over the frozen flat true_dom column.
-- Excluding ghosts removes the dominant error, but that expression remains an artifact.

-- The index the liveness gate depends on. scripts/admin/forceIndexes.ts declares it but
-- has evidently never been run here: pg_stat_user_indexes had no idx_listings_last_seen,
-- so every max(last_seen_at) was a Seq Scan over 273k rows.
CREATE INDEX IF NOT EXISTS idx_listings_last_seen ON public.listings (last_seen_at DESC NULLS LAST);

-- ------------------------------- region_active_aggregates -------------------------------
CREATE OR REPLACE FUNCTION public.region_active_aggregates(p_region text, p_subtypes text[] DEFAULT NULL::text[], p_min_beds integer DEFAULT 0, p_min_baths numeric DEFAULT 0, p_min_parking integer DEFAULT 0, p_min_frontage numeric DEFAULT 0, p_basement text DEFAULT 'any'::text)
RETURNS TABLE(active_count integer, cap_sample integer, median_cap_rate numeric, avg_cap_rate numeric, top_cap_rate numeric, stale_count integer)
LANGUAGE sql
STABLE
SET statement_timeout TO '90s'
AS $function$
  WITH ranked AS (
    SELECT
      last_seen_at,
      cap_rate_est AS cap,
      GREATEST(true_dom,
        CASE WHEN original_entry_timestamp IS NOT NULL
               THEN GREATEST(0, floor(EXTRACT(EPOCH FROM (now() - original_entry_timestamp)) / 86400))::int
             WHEN full_payload->>'OriginalEntryTimestamp' ~ '^\d{4}-\d{2}-\d{2}'
               THEN GREATEST(0, floor(EXTRACT(EPOCH FROM (now() - (full_payload->>'OriginalEntryTimestamp')::timestamptz)) / 86400))::int
             ELSE 0 END) AS eff_dom,
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
    SELECT r.cap, r.eff_dom
    FROM ranked r
    WHERE r.rn = 1
      -- Feed-verified liveness (see the header for the scoring and the fail-open rules).
      AND COALESCE(r.last_seen_at, '-infinity'::timestamptz) >= COALESCE((
            SELECT CASE WHEN s.t < now() - interval '21 days' THEN '-infinity'::timestamptz
                        ELSE s.t - interval '36 hours' END
            FROM (SELECT last_seen_at AS t FROM listings
                   WHERE last_seen_at IS NOT NULL
                   ORDER BY last_seen_at DESC LIMIT 1) s), '-infinity'::timestamptz)
  )
  SELECT
    count(*)::int,
    count(*) FILTER (WHERE cap IS NOT NULL AND cap >= 1 AND cap <= 15)::int,
    round(percentile_cont(0.5) WITHIN GROUP (ORDER BY cap) FILTER (WHERE cap IS NOT NULL AND cap >= 1 AND cap <= 15)::numeric, 2),
    round(avg(cap) FILTER (WHERE cap IS NOT NULL AND cap >= 1 AND cap <= 15), 2),
    round(max(cap) FILTER (WHERE cap IS NOT NULL AND cap >= 1 AND cap <= 15), 2),
    count(*) FILTER (WHERE eff_dom > 60)::int
  FROM active;
$function$;

-- --------------------------------- region_price_cuts -----------------------------------
CREATE OR REPLACE FUNCTION public.region_price_cuts(p_region text, p_subtypes text[] DEFAULT NULL::text[], p_min_beds integer DEFAULT 0, p_min_baths numeric DEFAULT 0, p_min_parking integer DEFAULT 0, p_min_frontage numeric DEFAULT 0, p_basement text DEFAULT 'any'::text)
RETURNS TABLE(active_count integer, cut_count integer, median_cut_amt integer, median_cut_pct numeric)
LANGUAGE sql
STABLE
SET statement_timeout TO '90s'
AS $function$
  WITH ranked AS (
    SELECT
      last_seen_at,
      list_price,
      total_price_drop AS drop,
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
    SELECT r.list_price, r.drop,
      (r.drop > 0 AND r.list_price > 0 AND (r.drop / (r.list_price + r.drop)) BETWEEN 0.005 AND 0.6) AS is_cut
    FROM ranked r
    WHERE r.rn = 1
      -- Feed-verified liveness (see the header for the scoring and the fail-open rules).
      AND COALESCE(r.last_seen_at, '-infinity'::timestamptz) >= COALESCE((
            SELECT CASE WHEN s.t < now() - interval '21 days' THEN '-infinity'::timestamptz
                        ELSE s.t - interval '36 hours' END
            FROM (SELECT last_seen_at AS t FROM listings
                   WHERE last_seen_at IS NOT NULL
                   ORDER BY last_seen_at DESC LIMIT 1) s), '-infinity'::timestamptz)
  )
  SELECT
    count(*)::int,
    count(*) FILTER (WHERE is_cut)::int,
    round(percentile_cont(0.5) WITHIN GROUP (ORDER BY drop) FILTER (WHERE is_cut))::int,
    round(percentile_cont(0.5) WITHIN GROUP (ORDER BY (drop / (list_price + drop) * 100)) FILTER (WHERE is_cut)::numeric, 1)
  FROM active;
$function$;
