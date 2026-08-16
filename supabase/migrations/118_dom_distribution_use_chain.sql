-- 118_dom_distribution_use_chain.sql
--
-- region_dom_distribution now reads the precomputed property_dom_chain (migration 117)
-- instead of re-unnesting property_campaign_history.events on every request.
--
-- The whole ev/gapped/flagged/cum/chain CTE pyramid from 114/116 collapses into one join
-- against a narrow table. Removing it also removes both of that version's landmines:
-- there is no longer a chain LEFT JOIN whose WHERE was load-bearing for the plan, and no
-- per-request stitch to be slow.
--
-- Toronto before: ~8.8s, of which ~2.95s was 9,682 nested-loop index probes into a 174MB
-- table. The stitch rule itself is unchanged -- it now lives in compute_dom_chain(), kept
-- current by trigger, so SQL and src/lib/campaignHistory/trueDom.ts still agree.
--
-- Liveness is unchanged from 116: feed-verified against the last heartbeat sweep, with
-- COALESCE fail-open so a broken heartbeat admits everything rather than emptying the
-- surface. DO NOT add last_seen_at to the DISTINCT ON ORDER BY -- the heartbeat stamps
-- every feed-present row with an IDENTICAL timestamp, so as a leading sort key it forms
-- one enormous tie block and the sort degenerates (measured: ~0.5s -> past the 90s
-- statement_timeout).

CREATE OR REPLACE FUNCTION public.region_dom_distribution(
  p_region       text,
  p_subtypes     text[]  DEFAULT NULL::text[],
  p_min_beds     integer DEFAULT 0,
  p_min_baths    numeric DEFAULT 0,
  p_min_parking  integer DEFAULT 0,
  p_min_frontage numeric DEFAULT 0,
  p_basement     text    DEFAULT 'any'::text
)
RETURNS TABLE(
  active_count     integer,
  median_true_dom  integer,
  median_naive_dom integer,
  p25_true_dom     integer,
  p75_true_dom     integer,
  dom_0_14         integer,
  dom_15_30        integer,
  dom_31_60        integer,
  dom_61_90        integer,
  dom_90_plus      integer
)
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
      AND COALESCE(l.last_seen_at, '-infinity'::timestamptz) >= COALESCE((
            SELECT CASE WHEN s.t < now() - interval '21 days' THEN '-infinity'::timestamptz
                        ELSE s.t - interval '36 hours' END
            FROM (SELECT last_seen_at AS t FROM listings
                   WHERE last_seen_at IS NOT NULL
                   ORDER BY last_seen_at DESC LIMIT 1) s), '-infinity'::timestamptz)
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
