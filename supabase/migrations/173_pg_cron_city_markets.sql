-- 173_pg_cron_city_markets.sql
--
-- Weekly dispatch of refresh-city-markets.yml, which rebuilds data/city-markets.json
-- (/data/housing-market/{city} for London, Kitchener and the other extra study cities: prices,
-- sales, sale-to-asking, price cuts) and commits it to main.
--
-- WHEN. Mondays at 12:27 UTC: after the 03:17 daily sync, and never the 5th's 12:xx monthly
-- data commits on the same minute. Same Vault token and helper as 127/128.
--
-- cron.schedule upserts on the name, so re-running this file retimes rather than duplicates.

SELECT cron.schedule('dispatch-refresh-city-markets', '27 12 * * 1',
                     $job$SELECT public.dispatch_github_workflow('refresh-city-markets.yml')$job$);
