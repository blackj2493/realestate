-- 178_pg_cron_monthly_report.sql
--
-- Monthly dispatch of build-monthly-report.yml, which builds the next edition of the Ontario
-- Housing Market Report (data/reports/{YYYY-MM}.json), pushes it to the branch
-- report/{YYYY-MM} and sends the PR link to Telegram. Nothing is published until the PR merges.
--
-- WHEN. The 20th at 11:17 UTC (6:17 or 7:17 a.m. Toronto). The price change refresh (168) runs
-- on the 5th, so its data file is current. Same Vault token and helper as 127/128.
--
-- cron.schedule upserts on the name, so re-running this file retimes rather than duplicates.

SELECT cron.schedule('dispatch-build-monthly-report', '17 11 20 * *',
                     $job$SELECT public.dispatch_github_workflow('build-monthly-report.yml')$job$);
