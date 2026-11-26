-- 176_pg_cron_property_tax.sql
--
-- Monthly dispatch of refresh-property-tax.yml, which rebuilds data/property-tax.json
-- (/data/property-tax: the annual property tax on sold listings by city, home type and
-- community) and commits it to main.
--
-- WHEN. The 5th at 13:17 UTC, 30 minutes after the best-time-to-sell refresh (12:47), so the
-- data commits do not race on main.
--
-- cron.schedule upserts on the name, so re-running this file retimes rather than duplicates.

SELECT cron.schedule('dispatch-refresh-property-tax', '17 13 5 * *',
                     $job$SELECT public.dispatch_github_workflow('refresh-property-tax.yml')$job$);
