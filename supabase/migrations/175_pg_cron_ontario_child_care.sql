-- 175_pg_cron_ontario_child_care.sql
--
-- Monthly dispatch of refresh-ontario-child-care.yml, which rebuilds
-- data/ontario-child-care.json (the "Child care nearby" block and the map pins outside
-- Toronto) from the Ontario Ministry of Education licensed child care list and commits it
-- to main.
--
-- WHEN. The 12th of each month at 10:37 UTC: the province posts each month's file around
-- the 10th. Off minute :00 like every other dispatch (see 128). Same Vault token and helper
-- as the jobs in 127/128 (public.dispatch_github_workflow).
--
-- cron.schedule upserts on the name, so re-running this file retimes rather than duplicates.

SELECT cron.schedule('dispatch-refresh-ontario-child-care', '37 10 12 * *',
                     $job$SELECT public.dispatch_github_workflow('refresh-ontario-child-care.yml')$job$);
