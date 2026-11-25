-- 174_pg_cron_child_care.sql
--
-- Weekly dispatch of refresh-child-care.yml, which rebuilds data/toronto-child-care.json
-- (the "Child care nearby" block on Toronto listings) from the City of Toronto feed and
-- commits it to main.
--
-- WHEN. Mondays at 09:47 UTC, off minute :00 like every other dispatch (see 128). Same
-- Vault token and helper as the jobs in 127/128 (public.dispatch_github_workflow).
--
-- cron.schedule upserts on the name, so re-running this file retimes rather than duplicates.

SELECT cron.schedule('dispatch-refresh-child-care', '47 9 * * 1',
                     $job$SELECT public.dispatch_github_workflow('refresh-child-care.yml')$job$);
