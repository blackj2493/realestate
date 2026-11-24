-- 171_pg_cron_sold_prices.sql
--
-- Monthly dispatch of refresh-sold-prices.yml, which rebuilds data/sold-prices.json
-- (/data/sold-prices: median sold prices per city by home type, bedrooms and community) and
-- commits it to main.
--
-- WHEN. The 5th at 12:17 UTC, after the other monthly data refreshes (167-170), so the data
-- commits do not race on main. Same Vault token and helper as 127/128.
--
-- cron.schedule upserts on the name, so re-running this file retimes rather than duplicates.

SELECT cron.schedule('dispatch-refresh-sold-prices', '17 12 5 * *',
                     $job$SELECT public.dispatch_github_workflow('refresh-sold-prices.yml')$job$);
