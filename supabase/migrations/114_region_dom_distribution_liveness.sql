-- 114_region_dom_distribution_liveness.sql
--
-- Fixes three defects in region_dom_distribution():
--
-- 1. LIVENESS. The old active test was
--       (last_seen_at IS NULL OR last_seen_at >= now() - interval '30 days')
--    but `listings.last_seen_at` is a row-CREATION timestamp: its column default is
--    now(), no trigger updates it, nothing in scripts/ or src/ writes it, and
--    174,544 of 174,544 non-null values equal created_at. So the filter selected
--    "rows inserted recently", rejecting 38,098 properties purely for having been
--    created >30d ago — i.e. exactly the aged inventory a days-on-market metric
--    exists to measure. The filter is removed entirely.
--
-- 2. TRUE DOM WAS AN ARTIFACT. The old body computed
--       td = GREATEST(listings.true_dom, age_since_OriginalEntryTimestamp)
--    where listings.true_dom is written per-sync-delta and freezes for stable
--    listings. td >= naive held by construction, and when the frozen value was
--    stale (the common case) td collapsed to exactly naive. The reported gap
--    measured nothing. True DOM is now derived from the campaign chain in
--    property_campaign_history by stitching consecutive Sale campaigns whose gap
--    (prior end -> next start) is <= 35 days — the same rule as
--    src/lib/campaignHistory/trueDom.ts, so SQL and app agree.
--
-- 3. STATUS SOURCE. listings.standard_status is an MLS change-event type
--    ('new', 'price change', 'extension'; only 7 rows say 'terminated'), not a
--    lifecycle field. Where a campaign row exists we trust its newest Sale
--    campaign status. Where it does not — 20,307 of 63,722 active properties,
--    mostly the 18,608 still lacking a property_hash — we fall back to the flat
--    non-terminal test so those listings are not silently dropped. As the
--    property_hash repair (#325) lands, the fallback shrinks on its own.
--
-- Signature and return columns are unchanged; callers need no edit.
-- Expect activeCount to RISE (Toronto ~10,421 -> ~13,633). That is the
-- correction, not a regression.

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
    -- NB: full_payload is a large toasted jsonb. Carrying it through the CTEs forced a
    -- detoast per scoped row and cost ~16s on Toronto. Project the two scalars we need
    -- here and never reference the column again downstream.
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
    ORDER BY coalesce(nullif(l.property_hash,''), nullif(l.norm_address,''), l.listing_key),
             l.original_entry_timestamp DESC NULLS LAST,
             l.listing_key DESC
  ),

  -- Sale campaigns for the scoped properties only.
  --
  -- NB: written as a LATERAL, not a plain JOIN. As a JOIN the planner underestimated
  -- `scoped` (54,326 est. vs 22,248 actual) and chose a merge join that scanned all
  -- 180,395 property_campaign_history rows, detoasting the full `events` jsonb for
  -- each — 14.4s of a 15s Toronto call, which blew the ~8s PostgREST ceiling even
  -- though the function's own statement_timeout (90s) was never reached. The LATERAL
  -- forces a nested loop that index-probes property_campaign_history_pkey once per
  -- scoped property instead.
  ev AS (
    SELECT s.property_hash,
           (ce.ev_json->>'entry_date')::timestamptz   AS entry_ts,
           NULLIF(ce.ev_json->>'end_date','')::date   AS end_d,
           ce.ev_json->>'status'                      AS status,
           row_number() OVER (PARTITION BY s.property_hash
                              ORDER BY (ce.ev_json->>'entry_date')::timestamptz DESC) AS rn
    FROM scoped s
    CROSS JOIN LATERAL (
      SELECT e AS ev_json
      FROM property_campaign_history h
      CROSS JOIN LATERAL jsonb_array_elements(h.events) e
      WHERE h.property_hash = s.property_hash
        AND e->>'transaction_type' = 'Sale'
        AND e->>'entry_date' ~ '^\d{4}-\d{2}-\d{2}'
    ) ce
    WHERE s.property_hash IS NOT NULL AND s.property_hash <> ''
  ),

  -- Gap to the next-newer campaign; mirrors trueDom.ts's nextStartMs.
  gapped AS (
    SELECT ev.*, LAG(entry_ts) OVER (PARTITION BY property_hash ORDER BY rn) AS newer_entry
    FROM ev
  ),

  -- Break the chain at the first hop with no terminal date or a >35d gap.
  flagged AS (
    SELECT gapped.*,
           CASE WHEN rn = 1                            THEN 0
                WHEN end_d IS NULL                     THEN 1  -- unknown terminal: never stitch across
                WHEN (newer_entry::date - end_d) > 35  THEN 1
                ELSE 0 END AS brk
    FROM gapped
  ),
  cum AS (
    SELECT flagged.*,
           SUM(brk) OVER (PARTITION BY property_hash ORDER BY rn ROWS UNBOUNDED PRECEDING) AS cb
    FROM flagged
  ),
  chain AS (
    SELECT property_hash,
           MIN(entry_ts) FILTER (WHERE cb = 0)  AS stitched_start,
           MAX(entry_ts)                        AS newest_entry,
           MAX(status)   FILTER (WHERE rn = 1)  AS newest_status
    FROM cum
    GROUP BY property_hash
  ),

  -- Hybrid liveness: campaign status when we have one, flat status otherwise.
  live AS (
    SELECT s.oet_ts, c.stitched_start, c.newest_entry
    FROM scoped s
    LEFT JOIN chain c ON c.property_hash = s.property_hash
    WHERE CASE
            WHEN c.property_hash IS NOT NULL THEN c.newest_status = 'Active'
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
