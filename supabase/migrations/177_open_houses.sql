-- 177: open_houses — the public open houses on MLS® listings, for /open-houses/{city}.
--
-- WHY. "open houses {city}" is searched ~18x "toronto housing market" in Ontario (Google Trends,
-- 12 months, 2026-11-26; autocomplete: Vaughan, Toronto, Richmond Hill, Mississauga, Ottawa,
-- "today"). The PropTx OpenHouse resource had about 3,800 open houses in the next 7 days, but
-- nothing stored them. Each feed row has only a ListingKey, so the sync adds the listing's City
-- from public.listings, and the pages filter on it.
--
-- Written by scripts/sync/syncOpenHouses.ts (sync-open-houses.yml, dispatched below every 6
-- hours). Read by the /open-houses pages through the service role. No browser access.
--
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS public.open_houses (
  open_house_key text        PRIMARY KEY,
  listing_key    text        NOT NULL,
  city           text,                    -- the listing's feed City (e.g. "Toronto C08"); null when not in listings
  transaction_type text,                  -- the listing's TransactionType: "For Sale" or "For Lease"
  open_date      date        NOT NULL,    -- OpenHouseDate (local date)
  start_at       timestamptz,
  end_at         timestamptz,
  open_type      text,                    -- "Public", "Broker", ...
  open_format    text,                    -- "In Person", "Virtual"
  status         text,                    -- "Active", "Cancelled", ...
  url            text,                    -- virtual tour / livestream link, when any
  modified_at    timestamptz,
  synced_at      timestamptz NOT NULL DEFAULT now()
);

-- Added after the first apply on 2026-11-26 (the table already existed in production).
ALTER TABLE public.open_houses ADD COLUMN IF NOT EXISTS transaction_type text;

CREATE INDEX IF NOT EXISTS open_houses_city_date_idx ON public.open_houses (city, open_date);
CREATE INDEX IF NOT EXISTS open_houses_date_idx ON public.open_houses (open_date);

ALTER TABLE public.open_houses ENABLE ROW LEVEL SECURITY;

-- ── Data API grants (REQUIRED since 2026-10-30) ─────────────────────────────────────────
-- service_role only: the sync writes with pg, the pages read with the service role client.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.open_houses TO service_role;

-- ── Schedule ───────────────────────────────────────────────────────────────────────────
-- Every 6 hours at :23 (agents add weekend open houses Wednesday to Saturday). GitHub drops
-- `schedule` runs under load, so pg_cron dispatches the workflow. cron.schedule upserts on the
-- name, so re-running this file retimes rather than duplicates. Apply AFTER the workflow file
-- is on main (workflow_dispatch only exists once it is).
SELECT cron.schedule('dispatch-sync-open-houses', '23 */6 * * *',
                     $job$SELECT public.dispatch_github_workflow('sync-open-houses.yml')$job$);
