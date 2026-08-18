-- 121_liveness_floor_from_recorded_sweep.sql
--
-- Fixes the feed-verified liveness gate introduced in 115/116/118, which has been
-- collapsing the active set on 6 nights out of 7 since 2026-08-16.
--
-- WHAT WENT WRONG
-- ---------------
-- The gate kept rows whose last_seen_at was within 36 HOURS of the WATERMARK, and took
-- the watermark to be `(SELECT last_seen_at FROM listings ORDER BY last_seen_at DESC
-- LIMIT 1)` — intended to mean "the last sweep".
--
-- It does not mean that. 115 deliberately lets a newly-created row keep the column
-- default now() so a brand-new listing is never dropped, and ~2,000 listings are created
-- every night. So the watermark tracks the NEWEST ROW CREATED, which is always ~now(),
-- never the sweep. Meanwhile the sweep that actually stamps last_seen_at — the
-- ghostReconcile heartbeat — runs WEEKLY (Sundays 08:00 UTC).
--
-- A 36-hour window cannot read a weekly signal. Measured 2026-08-18:
--
--   Toronto non-terminal actives                      20,734
--   ... within 36h of the watermark                      225   <- what /analytics served
--   ... feed-verified target (115 header)             10,041
--
-- The Sunday 2026-08-16 08:00 sweep stamped 96,246 rows in one hour. Those rows passed
-- the gate on the Monday and fell out of it by the Tuesday:
--
--   Aug 15  activeCount 10,368   (gate still dormant — no stamp had ever landed)
--   Aug 16     "           223   (metrics ran 05:00, BEFORE the 08:00 sweep)
--   Aug 17     "        10,176   (sweep 21h old — inside the window)
--   Aug 18     "           222   (sweep 46h old — outside the window)
--
-- The gate had been failing open since it shipped, because no stamp existed. The first
-- successful sweep did not fix it; it SWITCHED IT ON.
--
-- Blast radius was exactly the three gated functions and the four metrics they feed:
-- activeCount, monthsOfSupply (active / sold-per-month), trueDom and cutShare. Every
-- sold-derived metric comes from an ungated function and was never affected — which is
-- why the nightly canary flagged those four and nothing else.
--
-- THE FIX
-- -------
-- Measure from the sweep we RECORDED, not from a column that new rows pollute.
-- ghostReconcile now writes its completion to sync_state('last_seen_heartbeat') the same
-- way every other job records a cursor, and the gate reads that single row.
--
-- With a real sweep timestamp the 36-hour slack is meaningful again: it only has to
-- cover the sweep's own chunked duration, not the gap between sweeps. The window no
-- longer decays as the week goes on.
--
-- Centralised in ONE function so the three call sites cannot drift apart again — they
-- already had three byte-identical copies of this logic, which is how a single wrong
-- assumption reached three metrics at once.
--
-- FAIL-OPEN is preserved and now has two triggers, both yielding '-infinity' (admit
-- everything) rather than emptying every surface:
--   * no sync_state row at all — the heartbeat has never run
--   * a recorded sweep older than 21 days — the heartbeat has broken
--
-- Seeded below from the sweep already visible in the data, so the gate is correct
-- immediately rather than after next Sunday.
--
-- Read-only on `listings`. Replaces three functions and inserts one sync_state row.
--
-- Apply: npx tsx scripts/admin/applyMigrationFiles.ts 121_liveness_floor_from_recorded_sweep.sql

-- ── The single source of truth for the liveness floor ─────────────────────────
CREATE OR REPLACE FUNCTION public.feed_liveness_floor()
RETURNS timestamptz
LANGUAGE sql
STABLE
AS $fn$
  SELECT COALESCE(
    (SELECT CASE
              -- Heartbeat broken (or never ran recently): admit everything.
              WHEN s.last_sync_timestamp < now() - interval '21 days'
                THEN '-infinity'::timestamptz
              -- Slack covers the sweep's own chunked run, nothing more.
              ELSE s.last_sync_timestamp - interval '36 hours'
            END
       FROM sync_state s
      WHERE s.id = 'last_seen_heartbeat'),
    '-infinity'::timestamptz);
$fn$;

COMMENT ON FUNCTION public.feed_liveness_floor() IS
  'Cutoff for listings.last_seen_at "still in the feed" checks, measured from the sweep '
  'recorded in sync_state(last_seen_heartbeat). Never derive this from max(last_seen_at): '
  'new rows default to now(), so that watermark tracks row creation, not the sweep.';

-- ── Seed the heartbeat from the sweep already in the data ─────────────────────
-- The sweep is a mass stamp (96,246 rows in one hour on 2026-08-16); ordinary nightly
-- creation is ~2,000 spread across the day. Take the fullest hour, and only trust it if
-- it is unambiguously a sweep. If nothing qualifies, no row is written and the gate
-- fails open until ghostReconcile records its own — which is the safe direction.
INSERT INTO sync_state (id, last_sync_timestamp, sync_type, records_synced, status)
SELECT 'last_seen_heartbeat', s.hr, 'full', s.cnt::int, 'completed'
FROM (
  SELECT date_trunc('hour', last_seen_at) AS hr, count(*) AS cnt
  FROM listings
  WHERE last_seen_at IS NOT NULL
  GROUP BY 1
  ORDER BY cnt DESC
  LIMIT 1
) s
WHERE s.cnt >= 10000
ON CONFLICT (id) DO NOTHING;

-- ── The three gated functions, gate swapped for the helper ────────────────────
-- ================= region_active_aggregates =================
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
      AND COALESCE(r.last_seen_at, '-infinity'::timestamptz) >= public.feed_liveness_floor()
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


-- ================= region_dom_distribution =================
CREATE OR REPLACE FUNCTION public.region_dom_distribution(p_region text, p_subtypes text[] DEFAULT NULL::text[], p_min_beds integer DEFAULT 0, p_min_baths numeric DEFAULT 0, p_min_parking integer DEFAULT 0, p_min_frontage numeric DEFAULT 0, p_basement text DEFAULT 'any'::text)
 RETURNS TABLE(active_count integer, median_true_dom integer, median_naive_dom integer, p25_true_dom integer, p75_true_dom integer, dom_0_14 integer, dom_15_30 integer, dom_31_60 integer, dom_61_90 integer, dom_90_plus integer)
 LANGUAGE sql
 STABLE
 SET statement_timeout TO '90s'
AS $function$
  WITH scoped AS MATERIALIZED (
    SELECT DISTINCT ON (coalesce(nullif(l.property_hash,''), nullif(l.norm_address,''), l.listing_key))
           l.property_hash,
           l.original_entry_timestamp AS oet_ts,
           COALESCE(l.standard_status,
                    lower(coalesce(l.full_payload->>'Status',
                                   l.full_payload->>'MlsStatus',
                                   l.full_payload->>'StandardStatus',''))) AS eff_status
    FROM listings l
    WHERE (
        lower(l.city) = lower(p_region)
        OR lower(l.city_region) = lower(p_region)
        OR (lower(l.city) >= lower(p_region) || ' ' AND lower(l.city) < lower(p_region) || chr(33)
            AND lower(l.city) ~ ('^' || lower(p_region) || ' [cwe][0-9][0-9]$'))
        OR lower(l.full_payload->>'CountyOrParish') = lower(p_region))
      AND l.list_price >= 50000
      AND (p_subtypes IS NULL OR l.property_sub_type = ANY(p_subtypes))
      AND (p_min_beds     <= 0 OR COALESCE(l.bedrooms_total,          NULLIF(l.full_payload->>'BedroomsTotal', '')::numeric)         >= p_min_beds)
      AND (p_min_baths    <= 0 OR COALESCE(l.bathrooms_total_integer, NULLIF(l.full_payload->>'BathroomsTotalInteger', '')::numeric) >= p_min_baths)
      AND (p_min_parking  <= 0 OR COALESCE(l.parking_total,           NULLIF(l.full_payload->>'ParkingTotal', '')::numeric)          >= p_min_parking)
      AND (p_min_frontage <= 0 OR COALESCE(l.lot_width,               NULLIF(l.full_payload->>'LotWidth', '')::numeric)              >= p_min_frontage)
      AND (p_basement = 'any'
        OR (l.basement_tier IS NOT NULL AND ((p_basement='finished'   AND l.basement_tier BETWEEN 1 AND 5)
                                          OR (p_basement='unfinished' AND l.basement_tier BETWEEN 6 AND 8)))
        OR (l.basement_tier IS NULL AND ((p_basement='finished' AND l.full_payload->'Basement' ?| array['Finished','Apartment','Finished with Walk-Out','Partially Finished'])
                                      OR (p_basement='unfinished' AND l.full_payload->'Basement' ? 'Unfinished'))))
      -- Feed-verified liveness, measured against the last heartbeat sweep (not now()) so
      -- it holds between weekly sweeps, and FAILS OPEN if the heartbeat stops.
      AND COALESCE(l.last_seen_at, '-infinity'::timestamptz) >= public.feed_liveness_floor()
    -- DO NOT add last_seen_at here (see header).
    ORDER BY coalesce(nullif(l.property_hash,''), nullif(l.norm_address,''), l.listing_key),
             l.original_entry_timestamp DESC NULLS LAST,
             l.listing_key DESC
  ),
  live AS (
    SELECT s.oet_ts, c.stitched_start, c.newest_entry
    FROM scoped s
    LEFT JOIN property_dom_chain c ON c.property_hash = s.property_hash
    -- Keyed on newest_status, NOT on the row existing. property_dom_chain holds a row for
    -- every property in property_campaign_history (180,421) but only 124,929 have a sale
    -- chain; the rest are lease-only and carry NULLs. Testing `c.property_hash IS NOT
    -- NULL` would flip those from the flat-status fallback to an always-false status test
    -- and silently drop them (measured: Toronto 10,021 -> 9,977).
    WHERE CASE
            WHEN c.newest_status IS NOT NULL THEN c.newest_status = 'Active'
            ELSE s.eff_status NOT IN ('sold','closed','closed sale','leased','terminated','expired','suspended')
          END
  ),
  calc AS (
    SELECT
      GREATEST(0, floor(EXTRACT(EPOCH FROM (now() - COALESCE(l.newest_entry, l.oet_ts))) / 86400))::int AS naive,
      GREATEST(0, floor(EXTRACT(EPOCH FROM (now() - COALESCE(l.stitched_start, l.newest_entry, l.oet_ts))) / 86400))::int AS td
    FROM live l
    WHERE COALESCE(l.newest_entry, l.oet_ts) IS NOT NULL
  )
  SELECT
    count(*)::int,
    round(percentile_cont(0.5)  WITHIN GROUP (ORDER BY td))::int,
    round(percentile_cont(0.5)  WITHIN GROUP (ORDER BY naive))::int,
    round(percentile_cont(0.25) WITHIN GROUP (ORDER BY td))::int,
    round(percentile_cont(0.75) WITHIN GROUP (ORDER BY td))::int,
    count(*) FILTER (WHERE td BETWEEN 0  AND 14)::int,
    count(*) FILTER (WHERE td BETWEEN 15 AND 30)::int,
    count(*) FILTER (WHERE td BETWEEN 31 AND 60)::int,
    count(*) FILTER (WHERE td BETWEEN 61 AND 90)::int,
    count(*) FILTER (WHERE td >= 91)::int
  FROM calc;
$function$;


-- ================= region_price_cuts =================
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
      AND COALESCE(r.last_seen_at, '-infinity'::timestamptz) >= public.feed_liveness_floor()
  )
  SELECT
    count(*)::int,
    count(*) FILTER (WHERE is_cut)::int,
    round(percentile_cont(0.5) WITHIN GROUP (ORDER BY drop) FILTER (WHERE is_cut))::int,
    round(percentile_cont(0.5) WITHIN GROUP (ORDER BY (drop / (list_price + drop) * 100)) FILTER (WHERE is_cut)::numeric, 1)
  FROM active;
$function$;


