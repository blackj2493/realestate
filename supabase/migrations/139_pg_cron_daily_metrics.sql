-- 139_pg_cron_daily_metrics.sql
--
-- Schedules the morning operator report (.github/workflows/daily-metrics.yml) daily at
-- 11:35 UTC, through the same pg_cron → workflow_dispatch path as migrations 127/128/136.
--
-- WHY 11:35 UTC. Two constraints, one window:
--   * it must report a CLOSED Toronto day — yesterday ends at 04:00 UTC (05:00 in winter);
--   * it must run after the nightly digest writes its counters into metric_snapshots
--     '_ops' (~05:10 UTC), or the email-delivery section reports a night that has not
--     happened.
-- 11:35 UTC is 07:35 in Toronto through the summer and 06:35 in winter — the clock moves
-- under a fixed UTC cron, and that is accepted: a report that arrives an hour earlier in
-- January is fine, a report that reads half-written data is not.
--
-- The minute is off :00 and off the other jobs already on this schedule
-- (nightly-emails 06:47, optout-purge 09:53, data-health 10:41) so a slow neighbour
-- cannot delay it.
--
-- WHY NOT GitHub's own `schedule`: it is run at the lowest priority, was deferred by
-- hours on this repo, and dropped two consecutive days in August 2026 without ever
-- backfilling. A daily report that silently skips days is worse than no report, because
-- its absence looks the same as a quiet morning.

-- Refuse to run rather than half-install: this depends on migration 127's helper and on
-- the Vault secret it reads.
DO $guard$
BEGIN
  IF to_regprocedure('public.dispatch_github_workflow(text)') IS NULL THEN
    RAISE EXCEPTION 'migration 127 has not been applied — dispatch_github_workflow is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets WHERE name = 'github_workflow_dispatch_pat'
  ) THEN
    RAISE EXCEPTION 'vault secret github_workflow_dispatch_pat is missing';
  END IF;
END
$guard$;

-- cron.schedule(job_name, ...) upserts on the name, so re-running this file retimes
-- rather than duplicates. The server clock is UTC.
SELECT cron.schedule('dispatch-daily-metrics', '35 11 * * *',
                     $job$SELECT public.dispatch_github_workflow('daily-metrics.yml')$job$);

-- Verify:
--   SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'dispatch-daily-metrics';
--   SELECT id, status_code, error_msg, created FROM net._http_response ORDER BY id DESC LIMIT 5;
-- 204 is a successful dispatch; 401 means the PAT expired.
