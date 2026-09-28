-- 152: signup_attribution — where each account came from.
--
-- WHY
-- ───
-- Three Reddit posts produced nearly every signup the site has had (2026-08-17, 08-24,
-- 09-18), and no table recorded which post produced which account: auth.users and
-- profiles carry no UTM, referrer or landing page. PostHog's referrer cannot fill the gap
-- on the channel that matters — the Reddit iOS app sends no referrer and reads as direct.
--
-- The browser records two touches (src/lib/analytics/touch.ts) and /welcome posts them
-- with the Terms acceptance; /api/vow/accept-terms writes ONE row here, on the first-ever
-- acceptance only.
--
--   first_*  the arrival that introduced this browser to the site (never overwritten)
--   last_*   the most recent external arrival (UTM tag or outside referrer) before signup
--
-- A NULL row (no row at all) means an account created before this shipped, or a browser
-- with storage blocked. Written only by the service role; no client policy.
--
-- Additive and idempotent: safe to apply before or after the code deploys (the route
-- swallows a missing table).

create table if not exists public.signup_attribution (
  user_id              uuid primary key references auth.users (id) on delete cascade,
  first_utm_source     text,
  first_utm_medium     text,
  first_utm_campaign   text,
  first_utm_content    text,
  first_utm_term       text,
  first_referrer_host  text,
  first_landing_path   text,
  first_at             timestamptz,
  last_utm_source      text,
  last_utm_medium      text,
  last_utm_campaign    text,
  last_utm_content     text,
  last_utm_term        text,
  last_referrer_host   text,
  last_landing_path    text,
  last_at              timestamptz,
  created_at           timestamptz not null default now()
);

alter table public.signup_attribution enable row level security;

create index if not exists signup_attribution_last_campaign_idx
  on public.signup_attribution (last_utm_source, last_utm_campaign);
