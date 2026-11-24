-- 169_pg_cron_condo_prices.sql
--
-- Monthly dispatch of refresh-condo-prices.yml, which rebuilds data/condo-prices.json
-- (/data/condo-prices: condo prices, price per sq ft and fees by city, unit type and
-- community) and commits it to main.
--
-- WHEN. The 5th at 11:17 UTC, 30 minutes after the price change refresh (168): the condo
-- pages quote the price change file, and the data commits must not race on main.
--
-- cron.schedule upserts on the name, so re-running this file retimes rather than duplicates.

SELECT cron.schedule('dispatch-refresh-condo-prices', '17 11 5 * *',
                     $job$SELECT public.dispatch_github_workflow('refresh-condo-prices.yml')$job$);
