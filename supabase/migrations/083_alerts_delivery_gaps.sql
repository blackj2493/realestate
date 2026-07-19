-- Migration 083: alerts delivery gaps (spec follow-ups to 034/051/052/077).
--
-- 1. market_bubbles.area_type gains 'city' — city-scoped alert rows created by the
--    dashboard bell on plain city sections. City rows carry NO polygon (polygon = '[]');
--    the worker scopes them via the CITY_GROUPS expansion (src/lib/dashboard/area.ts
--    areaFilter), the same clause the dashboard city sections already query with.
--    They are alert-carriers only: BubbleSections filters them out of the drill-down
--    band, and the 10-bubble cap now counts only NON-city rows (city rows cost no
--    /stats polygon queries, and a user should be able to alert on every configured
--    region without eating their drawn-area budget).
-- 2. market_bubbles.notified_keys — per-bubble recently-alerted listing keys
--    ([{"k": "N1234567", "t": 1752900000000}, ...]). Lets the worker search a 72h
--    LOOKBACK window past the notify_since watermark (catching listings the feed
--    published late) without re-alerting keys already sent. Pruned to ~10 days.
-- 3. address_watches.last_listing_key — delivery baseline for the "Track this
--    address" worker phase. NULL = never baselined; '' = baselined with no active
--    listing; else the active MLS key we last saw/alerted for the address.
-- 4. watchlist.terminal_since — when the worker resolved the row to a terminal
--    non-transaction baseline (Terminated/Expired/Suspended/Unavailable). Bounds the
--    nightly relist re-scan to a 90-day window so long-dead rows stop costing an
--    address search every night.
--
-- All ADD COLUMNs are nullable or have non-volatile defaults → instant DDL, no
-- table rewrite. Run: npx tsx scripts/admin/applyMigrationFiles.ts 083_alerts_delivery_gaps.sql

-- ── 1. area_type 'city' ─────────────────────────────────────────────────────
ALTER TABLE public.market_bubbles
  DROP CONSTRAINT IF EXISTS market_bubbles_area_type_check;
ALTER TABLE public.market_bubbles
  ADD CONSTRAINT market_bubbles_area_type_check
  CHECK (area_type IN ('draw', 'commute', 'school', 'city'));

-- Cap counts only the expensive polygon/school rows; city alert rows are exempt.
CREATE OR REPLACE FUNCTION public.enforce_bubble_cap()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.area_type <> 'city'
     AND (SELECT COUNT(*) FROM public.market_bubbles
          WHERE user_id = NEW.user_id AND area_type <> 'city') >= 10 THEN
    RAISE EXCEPTION 'bubble_cap_reached: each account can save at most 10 market bubbles';
  END IF;
  RETURN NEW;
END;
$$;

-- ── 2. lookback dedup state ─────────────────────────────────────────────────
ALTER TABLE public.market_bubbles
  ADD COLUMN IF NOT EXISTS notified_keys JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.market_bubbles.notified_keys IS
  'Listing keys already emailed for this bubble ([{k,t},...], t = epoch ms). Enables the 72h lookback window past notify_since without duplicate alerts. Pruned to ~10 days by the worker.';

-- ── 3. address-watch delivery baseline ──────────────────────────────────────
ALTER TABLE public.address_watches
  ADD COLUMN IF NOT EXISTS last_listing_key TEXT;

COMMENT ON COLUMN public.address_watches.last_listing_key IS
  'Delivery baseline: NULL = never baselined; empty string = baselined with no active listing; else the active MLS key last seen/alerted at this address.';

-- ── 4. relist-scan window bound ─────────────────────────────────────────────
ALTER TABLE public.watchlist
  ADD COLUMN IF NOT EXISTS terminal_since TIMESTAMPTZ;

COMMENT ON COLUMN public.watchlist.terminal_since IS
  'When the alerts worker resolved this row to a terminal non-transaction baseline. The nightly relist re-scan only covers rows within 90 days of this stamp.';
