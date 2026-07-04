-- Migration 052: baseline columns for listing-alert DELIVERY (the nightly worker that
-- emails listing_alerts subscribers on price/status changes — scripts/worker/alerts.ts).
--
-- Compare-at-read (same model as watchlist.list_price/last_known_status): the worker
-- stores the last-seen price/status per subscription and emails only on a real change,
-- advancing the baseline ONLY after a successful send (idempotent — a Resend failure
-- retries tomorrow instead of eating the alert). `last_status IS NULL` = never baselined
-- yet → the worker seeds it silently on first sight (no backlog email). Instant DDL.
ALTER TABLE public.listing_alerts
  ADD COLUMN IF NOT EXISTS last_price       NUMERIC,
  ADD COLUMN IF NOT EXISTS last_status      TEXT,
  ADD COLUMN IF NOT EXISTS last_notified_at TIMESTAMPTZ;

COMMENT ON COLUMN public.listing_alerts.last_price IS
  'Last-seen ListPrice baseline; the worker emails when the live price drops below it, then advances it.';
COMMENT ON COLUMN public.listing_alerts.last_status IS
  'Last-seen MLS status baseline (NULL = never baselined → seed silently on first worker sight).';
