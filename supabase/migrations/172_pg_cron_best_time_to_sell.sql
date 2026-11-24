-- 172_pg_cron_best_time_to_sell.sql
--
-- Monthly dispatch of refresh-best-time-to-sell.yml, which rebuilds data/best-time-to-sell.json
-- (/data/best-time-to-sell: price, days on market and over-asking per city by month) and
-- commits it to main.
--
-- WHEN. The 5th at 12:47 UTC, after the other monthly data refreshes (167-171), so the data
-- commits do not race on main. Same Vault token and helper as 127/128.
--
-- cron.schedule upserts on the name, so re-running this file retimes rather than duplicates.

SELECT cron.schedule('dispatch-refresh-best-time-to-sell', '47 12 5 * *',
                     $job$SELECT public.dispatch_github_workflow('refresh-best-time-to-sell.yml')$job$);
