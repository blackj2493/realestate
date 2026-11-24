-- 170_pg_cron_school_prices.sql
--
-- Monthly dispatch of refresh-school-prices.yml, which rebuilds data/school-prices.json
-- (/data/school-catchment-prices: the school-catchment price premium per city and every public
-- elementary catchment) and commits it to main.
--
-- WHEN. The 5th at 11:47 UTC, 30 minutes after the condo prices refresh (169), so the data
-- commits do not race on main. Same Vault token and helper as 127/128.
--
-- cron.schedule upserts on the name, so re-running this file retimes rather than duplicates.

SELECT cron.schedule('dispatch-refresh-school-prices', '47 11 5 * *',
                     $job$SELECT public.dispatch_github_workflow('refresh-school-prices.yml')$job$);
