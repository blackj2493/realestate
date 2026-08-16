-- 093_reddit_opportunities.sql
-- Dedupe/state store for the Reddit-opportunity monitor
-- (scripts/marketing/redditMonitor.ts + .github/workflows/reddit-monitor.yml).
-- One row per Reddit post/comment that matched the marketing trigger taxonomy;
-- the primary key is Reddit's fullname (t3_xxx post / t1_xxx comment), which is
-- what makes every digest email pure never-seen-before signal.
--
-- Status lifecycle:
--   new       inserted, not yet emailed (emails go out same run; a row stuck
--             on 'new' means the digest send failed — the next run retries it)
--   emailed   included in a digest
--   overflow  matched but fell below the per-digest cap; never emailed
--   dismissed operator judged it not worth replying to   (set by hand/UI later)
--   replied   operator posted a reply                    (set by hand/UI later)

create table if not exists reddit_opportunities (
  id            text primary key,
  kind          text not null check (kind in ('post', 'comment')),
  subreddit     text not null,
  author        text,
  title         text,
  excerpt       text,
  url           text not null,
  category      text not null,
  score         numeric not null,
  triggers      text[] not null default '{}',
  city          text,
  created_utc   timestamptz not null,
  first_seen_at timestamptz not null default now(),
  emailed_at    timestamptz,
  status        text not null default 'new'
                check (status in ('new', 'emailed', 'overflow', 'dismissed', 'replied'))
);

comment on table reddit_opportunities is
  'Reddit posts/comments matched by the marketing monitor (scripts/marketing/redditMonitor.ts); PK = Reddit fullname, which is the digest dedupe key.';
comment on column reddit_opportunities.category is
  'Trigger-taxonomy id from redditMonitorConfig.ts (sold_data, market_pulse, brand_watch, …).';
comment on column reddit_opportunities.created_utc is
  'When the post/comment was created on Reddit (not when we saw it).';

-- The monitor's per-run query is "status = new"; the eventual review UI wants
-- recent-first browsing.
create index if not exists reddit_opportunities_status_seen_idx
  on reddit_opportunities (status, first_seen_at desc);

-- Service-role access only (the monitor script) — no anon/authenticated
-- policies on purpose, matching the other operational tables.
alter table reddit_opportunities enable row level security;
