-- 127_pg_cron_workflow_dispatch.sql
--
-- Moves the four time-critical GitHub Actions off GitHub's `schedule` trigger and onto
-- Supabase pg_cron, which POSTs a workflow_dispatch instead.
--
-- WHY. GitHub runs `schedule` at the lowest priority and drops it under load. Measured on
-- this repo: Daily Real Estate Sync started 6h44m after its 03:17 cron on 2026-08-29, and
-- Data Health Canary + Content Data Snapshot got no trigger AT ALL on 08-28 or 08-29. Both
-- read `active` in the Actions API, so nothing was disabled — GitHub simply skipped them,
-- and it never backfills a dropped run. PR #428 moved every cron off minute :00 and that did
-- not help, because the contention is not confined to the top of the hour.
--
-- pg_cron fires from a database that is already up 24 hours a day and already paid for. It
-- adds no vendor and no hosting.
--
-- WHAT DELIBERATELY STAYS ON GITHUB CRON:
--   schedule-watchdog.yml  it must stay INDEPENDENT. If Supabase is down, the watchdog is
--                          the thing that tells you the other four stopped.
--   nightly-emails.yml     its real trigger is workflow_run off the sync; the 06:47 cron is
--                          only a backstop.
--   weekly/monthly refresh jobs   low stakes, and a skipped week is visible in the data.
--
-- THE SECRET. The fine-grained GitHub PAT lives in Supabase Vault under the name
-- 'github_workflow_dispatch_pat', scoped to Actions read+write on blackj2493/realestate and
-- nothing else. It is never written into a workflow file, an env var, or this migration.
-- pg_cron runs a job as the role that scheduled it, so `postgres` reads it at fire time.
--
-- KNOWN GAP, on purpose. pg_net is asynchronous: http_post queues the request and returns an
-- id, so the cron job reports success even when GitHub later refuses the call. A dispatch
-- that fails therefore looks like a job that never ran, and the thing that catches it is
-- schedule-watchdog.yml's MISSED check. To read the truth directly:
--     SELECT id, status_code, error_msg, created FROM net._http_response ORDER BY id DESC LIMIT 10;
-- 204 is success. 401 means the token expired — the most likely future failure, since the
-- token has a fixed expiry recorded in its Vault description.
--
-- WARNING: the four workflow files must lose their `schedule:` block in the same change, or
-- every one of these jobs fires twice a day.

-- Refuse to run rather than half-install. Each of these is a dashboard action, not SQL:
-- the `postgres` role is not a superuser and cannot CREATE EXTENSION for pg_cron.
DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'net' AND p.proname = 'http_post'
  ) THEN
    RAISE EXCEPTION 'pg_net is not installed — enable it in the Supabase dashboard first';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'cron' AND p.proname = 'schedule'
  ) THEN
    RAISE EXCEPTION 'pg_cron is not installed — enable it in the Supabase dashboard first';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets WHERE name = 'github_workflow_dispatch_pat'
  ) THEN
    RAISE EXCEPTION 'vault secret github_workflow_dispatch_pat is missing';
  END IF;
END
$guard$;

-- One place that knows the repo, the token name and the header set. Four cron entries call
-- it, so retiring the token or moving the repo is a one-line change here, not a four-line
-- edit across job definitions that are easy to half-update.
CREATE OR REPLACE FUNCTION public.dispatch_github_workflow(p_workflow_file text)
RETURNS bigint
LANGUAGE plpgsql
VOLATILE
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_token      text;
  v_request_id bigint;
BEGIN
  SELECT decrypted_secret INTO v_token
  FROM vault.decrypted_secrets
  WHERE name = 'github_workflow_dispatch_pat';

  IF v_token IS NULL THEN
    RAISE EXCEPTION 'vault secret github_workflow_dispatch_pat is missing or unreadable';
  END IF;

  SELECT net.http_post(
    url := 'https://api.github.com/repos/blackj2493/realestate/actions/workflows/'
           || p_workflow_file || '/dispatches',
    body := jsonb_build_object('ref', 'main'),
    headers := jsonb_build_object(
      'Authorization',        'Bearer ' || v_token,
      'Accept',               'application/vnd.github+json',
      'X-GitHub-Api-Version', '2022-11-28',
      'Content-Type',         'application/json',
      'User-Agent',           'pureproperty-pg-cron'
    ),
    timeout_milliseconds := 10000
  ) INTO v_request_id;

  RETURN v_request_id;
END;
$fn$;

COMMENT ON FUNCTION public.dispatch_github_workflow(text) IS
  'POSTs a GitHub workflow_dispatch for the named workflow file on branch main, using the '
  'fine-grained PAT in Vault under github_workflow_dispatch_pat. Called by the dispatch-* '
  'pg_cron jobs (migration 127). Async: the returned id is a net._http_response row, not '
  'proof that GitHub accepted the call.';

-- Nothing but the cron jobs (which run as postgres) should be able to start a workflow.
REVOKE ALL ON FUNCTION public.dispatch_github_workflow(text) FROM PUBLIC, anon, authenticated;

-- cron.schedule(job_name, ...) upserts on the name, so re-running this file is safe and
-- retimes an existing job rather than creating a duplicate.
-- The times are the crons these workflows used to carry, unchanged, so every "runs after the
-- 03:00 sync" comment elsewhere in the repo stays true. The server clock is UTC.
SELECT cron.schedule('dispatch-daily-sync',            '17 3 * * *',
                     $job$SELECT public.dispatch_github_workflow('daily-sync.yml')$job$);
SELECT cron.schedule('dispatch-content-data-snapshot', '26 9 * * *',
                     $job$SELECT public.dispatch_github_workflow('content-data-snapshot.yml')$job$);
SELECT cron.schedule('dispatch-data-health',           '41 10 * * *',
                     $job$SELECT public.dispatch_github_workflow('data-health.yml')$job$);
SELECT cron.schedule('dispatch-freshness-check',       '28 */6 * * *',
                     $job$SELECT public.dispatch_github_workflow('freshness-check.yml')$job$);
