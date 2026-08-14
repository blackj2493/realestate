-- 116_dom_feed_verified_liveness.sql
--
-- Completes the work #344 started: region_dom_distribution now uses FEED-VERIFIED
-- liveness, matching region_active_aggregates and region_price_cuts.
--
-- Migration 114 kept a HYBRID test (newest campaign status where a campaign row exists,
-- flat non-terminal status otherwise). Scored row-by-row against a live feed snapshot
-- (112,676 Active keys), that kept 117,857 rows of which 50,720 were NOT in the feed —
-- 57.0% precision. Ghosts are old listings by construction, so they inflated both clocks:
--
--   Toronto   114 hybrid 71->92d (+29.6%)   feed-verified 44->65d (+47.7%)  n 17,330->10,032
--   Ottawa    114 hybrid 65->84d (+29.2%)   feed-verified 44->62d (+40.9%)  n  6,251-> 3,813
--   Hamilton  114 hybrid 71->99d (+39.4%)   feed-verified 48->71d (+47.9%)  n  3,448-> 2,100
--
-- Absolute medians fall ~27 days. The HIDDEN-DAYS figure (~21d Toronto) is unchanged by
-- any of this, because ghosts shift the reported and real clocks by the same offset —
-- which is why that, not the percentage, is the number worth quoting.
--
-- WHY THIS IS A SEPARATE MIGRATION FROM 115
-- -----------------------------------------
-- 115 tried the same gate here and had to be split out: it ran 5-8x SLOWER than 114
-- while processing FEWER rows, and Toronto exceeded the 90s statement_timeout. The cause
-- was not the gate. 115 had also changed the DISTINCT ON ordering to lead with
-- `last_seen_at DESC NULLS LAST`, and the heartbeat stamps every feed-present row with an
-- IDENTICAL timestamp (94,590 rows per sweep) — so that key became one enormous tie block
-- and the sort degenerated. Self-inflicted, and invisible until the column was populated.
-- With 114's ordering left intact, the gate costs nothing: Toronto ~0.5-0.8s, Hamilton
-- ~0.14s, generic plan included.
--
-- Signature and return columns unchanged; callers need no edit.

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
      -- FEED-VERIFIED LIVENESS. See 115 for the scoring: against a real feed snapshot the
      -- old last_seen_at gate scored 53.7% precision / 59.1% recall — worse than no gate
      -- on BOTH axes — while feed presence is ~100%/~100%. Measured against the last SWEEP
      -- rather than now(), so it holds between weekly heartbeats, and FAILS OPEN (no
      -- stamps, or newest stamp older than 21d) rather than emptying the surface.
      AND COALESCE(l.last_seen_at, '-infinity'::timestamptz) >= COALESCE((
            SELECT CASE WHEN s.t < now() - interval '21 days' THEN '-infinity'::timestamptz
                        ELSE s.t - interval '36 hours' END
            FROM (SELECT last_seen_at AS t FROM listings
                   WHERE last_seen_at IS NOT NULL
                   ORDER BY last_seen_at DESC LIMIT 1) s), '-infinity'::timestamptz)
    -- DO NOT add last_seen_at to this ORDER BY. Migration 115's attempt led with
    -- `last_seen_at DESC NULLS LAST` here and the function went from ~0.5s to past the
    -- 90s statement_timeout. The heartbeat stamps every feed-present row with an
    -- IDENTICAL timestamp (94,590 rows in a single sweep), so as the leading DISTINCT ON
    -- sort key it forms one enormous tie block and the sort degenerates. The cost was
    -- invisible before the column was ever populated.
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

  -- Feed-verified (in `scoped`) AND 114's campaign/flat test, deliberately BOTH.
  --
  -- Feed presence is the accurate signal and does nearly all the work — 114's hybrid
  -- alone kept 117,857 rows of which 50,720 were ghosts (57.0% precision). On top of
  -- feed-verified rows this second test removes only ~20 more in Toronto (10,041 ->
  -- 10,021): properties the feed still lists but whose newest campaign says terminated.
  --
  -- It is kept for a measured reason, not tidiness: dropping this WHERE made the function
  -- exceed the 90s statement_timeout on Toronto, while the identical query WITH it runs in
  -- ~0.5-0.8s. The predicate evidently lets the planner discard chain rows early instead
  -- of materialising the full LEFT JOIN. Removing it looks like a harmless simplification
  -- and is not.
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
