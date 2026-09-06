-- 139_pg_cron_retrain_avm_offpeak.sql
--
-- Moves the monthly AVM retrain off 08:00 UTC, where it shared a slot with the weekly
-- ghost reconcile. Retimes only; same pg_cron → workflow_dispatch path as 127/128/136.
--
--     dispatch-retrain-avm       0 8 6 * *    →  0 14 6 * *
--
-- WHY. On 2026-09-06 the 6th fell on a Sunday, so `dispatch-ghost-reconcile` (0 8 * * 0)
-- and `dispatch-retrain-avm` (0 8 6 * *) both fired at 08:00:01 against the same database.
-- The reconcile ran 18 minutes. The retrain's staging write was row-at-a-time then — its
-- cost was round-trip latency × row count — so tripled latency turned an 8m36s write into
-- one that never finished, and the step died on its 30-minute timeout with the transaction
-- open. The month produced no model. (Run 34020624323.)
--
-- PR #498 made that write set-based (unnest, 35,400 round trips → 8), so the retrain no
-- longer BREAKS under a noisy neighbour. This migration is the other half: the two jobs
-- still contend for the same database for 18 minutes, and the retrain's two backtests read
-- 4,000 held-out sales each right through that window. Separating them is what stops the
-- contention; #498 is what stops it from being fatal. Neither alone is the whole fix.
--
-- WHY 14:00. It is a clear three-hour window — the nearest neighbours are the 12:30
-- monthly market brief (3rd–5th, so never the 6th) and the 16:28 freshness check. It is
-- also 10:00 in Toronto, and that is deliberate: a SCHEDULED retrain AUTO-PROMOTES a
-- winning challenger to production. A model swap should land while someone is awake to
-- read the verdict email, not at 04:00 local.
--
-- Full slot map at the time of writing (UTC): 03:17 daily sync · :28 every 6h freshness ·
-- 05:00 Mon rental index · 06:00 Mon condo-fee + dev-activity · 07:33 Sun/Wed recompute ·
-- 08:00 Sun ghost reconcile · 09:00 Wed backfill · 09:26 snapshot · 09:53 opt-out purge ·
-- 10:41 data health · 12:30 market brief.
--
-- KNOWN REMAINING OVERLAP, deliberately left alone: `dispatch-refresh-schools`
-- (0 8 1 1,4,7,10 *) still shares 08:00 with the ghost reconcile whenever the 1st of
-- Jan/Apr/Jul/Oct is a Sunday. That job is short and quarterly; retime it only if it
-- actually starts failing.
--
-- Same async caveat as migration 127: pg_net queues the POST and returns an id, so the
-- cron job reports success even if GitHub later refuses the call. To read the truth:
--     SELECT id, status_code, error_msg, created FROM net._http_response ORDER BY id DESC LIMIT 10;

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

  -- Retime, never create. If the job is absent, migration 128 did not run and silently
  -- scheduling a new one here would hide that.
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'dispatch-retrain-avm') THEN
    RAISE EXCEPTION 'cron job dispatch-retrain-avm does not exist — apply migration 128 first';
  END IF;
END
$guard$;

-- cron.schedule(job_name, ...) upserts on the name, so re-running this file retimes
-- rather than duplicates. The server clock is UTC.
SELECT cron.schedule('dispatch-retrain-avm', '0 14 6 * *',
                     $job$SELECT public.dispatch_github_workflow('retrain-avm.yml')$job$);

DO $verify$
DECLARE
  got text;
BEGIN
  SELECT schedule INTO got FROM cron.job WHERE jobname = 'dispatch-retrain-avm';
  IF got IS DISTINCT FROM '0 14 6 * *' THEN
    RAISE EXCEPTION 'dispatch-retrain-avm is still scheduled at %, expected 0 14 6 * *', got;
  END IF;
  RAISE NOTICE 'dispatch-retrain-avm now runs at 0 14 6 * * (was 0 8 6 * *)';
END
$verify$;
