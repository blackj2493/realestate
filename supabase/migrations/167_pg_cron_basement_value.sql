-- 167_pg_cron_basement_value.sql
--
-- Monthly dispatch of refresh-basement-value.yml, which rebuilds data/basement-value.json
-- (/data/basement-value) from the last 24 full months of sales and commits it to main.
--
-- WHEN. The 5th at 10:17 UTC: late enough that last month's sales have reached the feed,
-- off minute :00 like every other dispatch (see 128). Same Vault token and helper as the
-- 18 jobs in 127/128 (public.dispatch_github_workflow).
--
-- cron.schedule upserts on the name, so re-running this file retimes rather than duplicates.

SELECT cron.schedule('dispatch-refresh-basement-value', '17 10 5 * *',
                     $job$SELECT public.dispatch_github_workflow('refresh-basement-value.yml')$job$);
