-- 092_market_rates.sql
-- Single-row-per-key store for market reference rates the app seeds calculators
-- with. Currently the typical 5-year fixed mortgage rate, refreshed monthly from
-- the Bank of Canada Valet API by scripts/admin/refresh-mortgage-rate.ts
-- (+ .github/workflows/refresh-mortgage-rate.yml). Read via
-- src/lib/finance/getMortgageRate.ts (cached 24h, hardcoded fallback), so a
-- missing/stale row degrades gracefully instead of breaking the calculator.

create table if not exists market_rates (
  key         text primary key,
  rate_pct    numeric(5,3) not null,
  as_of       date not null,
  source      text,
  updated_at  timestamptz not null default now()
);

comment on table market_rates is 'Market reference rates (e.g. 5-yr fixed mortgage) seeded into calculators; refreshed by scheduled jobs.';
comment on column market_rates.rate_pct is 'Rate as a percent — 5.290 = 5.29%.';
comment on column market_rates.as_of is 'Date the underlying source figure is dated; staleness is measured from here.';

-- Seed the fallback so the very first read (before the refresh job has ever run)
-- returns a sane value rather than nothing.
insert into market_rates (key, rate_pct, as_of, source)
values ('five_year_fixed', 5.500, current_date, 'seed (fallback) — pending first Bank of Canada refresh')
on conflict (key) do nothing;
