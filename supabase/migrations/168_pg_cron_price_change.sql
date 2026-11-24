-- 168_pg_cron_price_change.sql
--
-- Monthly dispatch of refresh-price-change.yml, which rebuilds data/price-change.json
-- (/data/price-change: same-home price change by city and home type) and commits it to main.
--
-- WHEN. The 5th at 10:47 UTC, 30 minutes after the basement refresh (167) so the two data
-- commits do not race on main. Same Vault token and helper as 127/128.
--
-- cron.schedule upserts on the name, so re-running this file retimes rather than duplicates.

SELECT cron.schedule('dispatch-refresh-price-change', '47 10 5 * *',
                     $job$SELECT public.dispatch_github_workflow('refresh-price-change.yml')$job$);
