-- 128_pg_cron_weekly_monthly.sql
--
-- Finishes what migration 127 started: the remaining 14 weekly, twice-weekly, monthly and
-- quarterly jobs move off GitHub's `schedule` trigger onto Supabase pg_cron.
--
-- WHY THESE, AND WHY NOW. 127 moved the four daily jobs because they were visibly broken.
-- These 14 were left behind as low stakes — but 13 of them sit on minute :00, the slot
-- GitHub defers hardest, and a weekly job that gets dropped is invisible: it simply does not
-- run, and the next scheduled attempt is a week away. Nothing watches them.
--
-- Every time below is the cron the workflow already carried, unchanged. This migration
-- changes WHO fires these jobs, never WHEN.
--
-- ONE TOKEN, EIGHTEEN JOBS — read this before it bites. All 18 dispatch jobs authenticate
-- with the single Vault secret github_workflow_dispatch_pat, so its expiry stops everything
-- at once. That is survivable only because the four DAILY jobs from 127 are watched by
-- schedule-watchdog.yml: a dead token silences them within 26 hours and the watchdog mails
-- you, which is long before any weekly job here would next be due. The daily jobs are the
-- canary for the weekly ones. Do not remove them from WATCHED.
--
-- Verified before writing this file: none of the 14 branches on `github.event_name`, so
-- losing the `schedule` event changes no behaviour. Two declare workflow_dispatch inputs and
-- both are optional with defaults — backfill-missing-actives reads
-- `github.event.inputs.limit || '4000'` (the declared default is also '4000'), and
-- retrain-avm compares `[ "$COMPARE_ONLY" = "true" ]`, an exact string test that treats the
-- schedule event's empty string and the dispatch default 'false' identically.
--
-- WARNING: the 14 workflow files must lose their `schedule:` block in the same change, or
-- every one of these jobs fires twice.

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

-- cron.schedule(job_name, ...) upserts on the name, so re-running this file retimes rather
-- than duplicates. The server clock is UTC.

-- Weekly
SELECT cron.schedule('dispatch-refresh-rental-index',     '0 5 * * 1',
                     $job$SELECT public.dispatch_github_workflow('refresh-rental-index.yml')$job$);
SELECT cron.schedule('dispatch-refresh-condo-fee-stats',  '0 6 * * 1',
                     $job$SELECT public.dispatch_github_workflow('refresh-condo-fee-stats.yml')$job$);
SELECT cron.schedule('dispatch-refresh-dev-activity',     '0 6 * * 1',
                     $job$SELECT public.dispatch_github_workflow('refresh-dev-activity.yml')$job$);
SELECT cron.schedule('dispatch-ghost-reconcile',          '0 8 * * 0',
                     $job$SELECT public.dispatch_github_workflow('ghost-reconcile.yml')$job$);
SELECT cron.schedule('dispatch-backfill-missing-actives', '0 9 * * 3',
                     $job$SELECT public.dispatch_github_workflow('backfill-missing-actives.yml')$job$);

-- Twice weekly
SELECT cron.schedule('dispatch-estimates-recompute',      '33 7 * * 0,3',
                     $job$SELECT public.dispatch_github_workflow('estimates-recompute.yml')$job$);

-- Monthly
SELECT cron.schedule('dispatch-refresh-mortgage-rate',    '0 11 1 * *',
                     $job$SELECT public.dispatch_github_workflow('refresh-mortgage-rate.yml')$job$);
SELECT cron.schedule('dispatch-monitor-avm-accuracy',     '0 9 3 * *',
                     $job$SELECT public.dispatch_github_workflow('monitor-avm-accuracy.yml')$job$);
SELECT cron.schedule('dispatch-monthly-market-brief',     '30 12 3-5 * *',
                     $job$SELECT public.dispatch_github_workflow('monthly-market-brief.yml')$job$);
SELECT cron.schedule('dispatch-retrain-avm',              '0 8 6 * *',
                     $job$SELECT public.dispatch_github_workflow('retrain-avm.yml')$job$);
SELECT cron.schedule('dispatch-refresh-geo',              '0 6 15 * *',
                     $job$SELECT public.dispatch_github_workflow('refresh-geo.yml')$job$);
SELECT cron.schedule('dispatch-refresh-zoning',           '0 6 20 * *',
                     $job$SELECT public.dispatch_github_workflow('refresh-zoning.yml')$job$);

-- Quarterly
SELECT cron.schedule('dispatch-refresh-schools',          '0 8 1 1,4,7,10 *',
                     $job$SELECT public.dispatch_github_workflow('refresh-schools.yml')$job$);
SELECT cron.schedule('dispatch-refresh-amenities',        '0 7 5 2,5,8,11 *',
                     $job$SELECT public.dispatch_github_workflow('refresh-amenities.yml')$job$);
