-- 117_property_dom_chain.sql
--
-- Makes region_dom_distribution fast by precomputing the campaign stitch instead of
-- recomputing it per request.
--
-- THE PROBLEM
-- -----------
-- Toronto took ~8.8s. EXPLAIN put ~2.95s of that in ONE node: a nested loop doing 9,682
-- individual index probes into property_campaign_history at ~0.300ms each. Migration 114
-- deliberately forced that nested loop (via LATERAL) because the alternative merge join
-- scanned all 180,395 rows of a 174MB table. So the planner only had two bad options:
-- ~10k random index descents, or a full scan of 174MB.
--
-- It is NOT a TOAST problem -- the toast relation is 0 bytes and `events` averages 636
-- bytes, comfortably inline. The same 10k rows unnested as a set-based join cost 106ms,
-- ~30x cheaper than the same work done one probe at a time. The cost is the access
-- pattern, not the data.
--
-- THE FIX
-- -------
-- Precompute the three values the RPC actually needs -- stitched_start, newest_entry,
-- newest_status -- into a narrow table (~40 bytes/row vs ~1KB). Joining ~7MB instead of
-- 174MB makes every plan cheap, so the RPC no longer has to be tricked into one.
--
-- Kept in sync by a trigger on property_campaign_history rather than by a nightly job, so
-- it cannot silently drift the way last_seen_at did (see #343): any writer that touches
-- `events` refreshes the derived row in the same transaction.
--
-- The stitch rule is unchanged and still mirrors src/lib/campaignHistory/trueDom.ts:
-- consecutive Sale campaigns join when the gap (prior end -> next start) is <= 35 days;
-- a campaign with no terminal date is never stitched across.

CREATE TABLE IF NOT EXISTS public.property_dom_chain (
  property_hash   varchar PRIMARY KEY,
  stitched_start  timestamptz,   -- earliest start of the current stitched sale chain
  newest_entry    timestamptz,   -- newest sale campaign's entry date (the board clock)
  newest_status   text,          -- newest sale campaign's status ('Active', 'Sold', ...)
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.property_dom_chain IS
  'Derived from property_campaign_history.events by trigger: the 35-day-stitched sale-campaign span per property. Exists so region_dom_distribution joins ~7MB of scalars instead of re-unnesting a 174MB jsonb table per request (migration 117).';

-- Recompute one property's chain from its events array. Shared by the trigger and the
-- backfill so there is exactly one copy of the stitch rule in SQL.
CREATE OR REPLACE FUNCTION public.compute_dom_chain(p_events jsonb)
RETURNS TABLE(stitched_start timestamptz, newest_entry timestamptz, newest_status text)
LANGUAGE sql
IMMUTABLE
AS $function$
  WITH ev AS (
    SELECT (e->>'entry_date')::timestamptz         AS entry_ts,
           NULLIF(e->>'end_date','')::date         AS end_d,
           e->>'status'                            AS status,
           row_number() OVER (ORDER BY (e->>'entry_date')::timestamptz DESC) AS rn
    FROM jsonb_array_elements(COALESCE(p_events, '[]'::jsonb)) e
    WHERE e->>'transaction_type' = 'Sale'
      AND e->>'entry_date' ~ '^\d{4}-\d{2}-\d{2}'
  ),
  gapped AS (SELECT ev.*, LAG(entry_ts) OVER (ORDER BY rn) AS newer_entry FROM ev),
  flagged AS (
    SELECT gapped.*,
           CASE WHEN rn = 1                           THEN 0
                WHEN end_d IS NULL                    THEN 1  -- unknown terminal: never stitch across
                WHEN (newer_entry::date - end_d) > 35 THEN 1
                ELSE 0 END AS brk
    FROM gapped
  ),
  cum AS (SELECT flagged.*, SUM(brk) OVER (ORDER BY rn ROWS UNBOUNDED PRECEDING) AS cb FROM flagged)
  SELECT MIN(entry_ts) FILTER (WHERE cb = 0),
         MAX(entry_ts),
         MAX(status)   FILTER (WHERE rn = 1)
  FROM cum;
$function$;

CREATE OR REPLACE FUNCTION public.pch_refresh_dom_chain()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.compute_dom_chain(NEW.events);
  INSERT INTO public.property_dom_chain (property_hash, stitched_start, newest_entry, newest_status, updated_at)
  VALUES (NEW.property_hash, r.stitched_start, r.newest_entry, r.newest_status, now())
  ON CONFLICT (property_hash) DO UPDATE
    SET stitched_start = EXCLUDED.stitched_start,
        newest_entry   = EXCLUDED.newest_entry,
        newest_status  = EXCLUDED.newest_status,
        updated_at     = now();
  RETURN NULL;
END
$function$;

DROP TRIGGER IF EXISTS trg_pch_dom_chain ON public.property_campaign_history;
CREATE TRIGGER trg_pch_dom_chain
  AFTER INSERT OR UPDATE OF events ON public.property_campaign_history
  FOR EACH ROW EXECUTE FUNCTION public.pch_refresh_dom_chain();

-- Backfill (set-based, not per-row: the whole point of this migration).
INSERT INTO public.property_dom_chain (property_hash, stitched_start, newest_entry, newest_status, updated_at)
SELECT h.property_hash, d.stitched_start, d.newest_entry, d.newest_status, now()
FROM public.property_campaign_history h
CROSS JOIN LATERAL public.compute_dom_chain(h.events) d
ON CONFLICT (property_hash) DO UPDATE
  SET stitched_start = EXCLUDED.stitched_start,
      newest_entry   = EXCLUDED.newest_entry,
      newest_status  = EXCLUDED.newest_status,
      updated_at     = now();

ANALYZE public.property_dom_chain;
