-- 145_workflow_dispatch_audit.sql
--
-- Makes a FAILED workflow dispatch traceable after the fact. Closes the "KNOWN GAP" that
-- migration 127 wrote down and 2026-09-15 then walked straight into.
--
-- WHAT HAPPENED. cron.job 2 (dispatch-content-data-snapshot) fired on time at
-- 2026-09-15T09:26:00.192Z and cron.job_run_details recorded 'succeeded'. GitHub created no
-- run. The dispatch POST left the database and was refused or lost, and because pg_net is
-- asynchronous the cron job never knew: http_post queues the request, returns an id, and the
-- status code lands later in net._http_response.
--
-- WHY NOBODY COULD SAY WHY. pg_net.ttl is 6 hours, so that response row was deleted long
-- before anyone looked. schedule-watchdog.yml only declares a job MISSED at 26h — so by
-- construction the evidence is ALWAYS gone by the time the alert arrives. 127 documented the
-- query to run; it just cannot be run in time. The token was fine (data-health dispatched
-- successfully at 10:41 the same morning), the workflow file was unchanged, and the pg_net
-- queue was empty, so the cause is still unknown and now unknowable for that date.
--
-- WHAT THIS ADDS. Every dispatch records its request id immediately. A job every 15 minutes
-- copies the status code out of net._http_response before the ttl drops it, and marks a
-- request that never answered at all. A 401, 422 or 5xx is then still readable a week later:
--
--     SELECT dispatched_at, workflow_file, status_code, error_msg
--     FROM public.workflow_dispatch_log
--     WHERE status_code IS DISTINCT FROM 204
--     ORDER BY dispatched_at DESC;
--
-- 204 is success. 401 means the Vault token expired — still the most likely future failure,
-- and now it names itself instead of looking like eighteen jobs that quietly stopped.

CREATE TABLE IF NOT EXISTS public.workflow_dispatch_log (
  id            bigserial PRIMARY KEY,
  workflow_file text        NOT NULL,
  -- net.http_post's return value. The join key to net._http_response, for as long as that
  -- row survives; kept here permanently either way.
  request_id    bigint      NOT NULL,
  dispatched_at timestamptz NOT NULL DEFAULT now(),
  -- NULL until settle_workflow_dispatch_log() resolves it. 204 = GitHub accepted.
  status_code   integer,
  error_msg     text,
  settled_at    timestamptz
);

CREATE INDEX IF NOT EXISTS workflow_dispatch_log_dispatched
  ON public.workflow_dispatch_log (dispatched_at DESC);
-- The settle job scans only what is still open, which stays a handful of rows.
CREATE INDEX IF NOT EXISTS workflow_dispatch_log_unsettled
  ON public.workflow_dispatch_log (dispatched_at) WHERE settled_at IS NULL;

-- Service-role only, same as every other ops table here (see 111, 129). No policies, so
-- PostgREST hands anon and authenticated nothing.
ALTER TABLE public.workflow_dispatch_log ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.workflow_dispatch_log IS
  'One row per pg_cron -> GitHub workflow_dispatch POST. Survives pg_net''s 6h response ttl so a refused dispatch can still be diagnosed. Written by dispatch_github_workflow(), resolved by settle_workflow_dispatch_log(). Service-role only. See migration 145.';

-- Unchanged except for the INSERT: same url, same headers, same token, same return value.
CREATE OR REPLACE FUNCTION public.dispatch_github_workflow(p_workflow_file text)
RETURNS bigint
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
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

  -- Record it here, not in the cron command, so all 18 jobs are covered by the one change.
  INSERT INTO public.workflow_dispatch_log (workflow_file, request_id)
  VALUES (p_workflow_file, v_request_id);

  RETURN v_request_id;
END;
$function$;

/**
 * Copies dispatch outcomes out of net._http_response before pg_net's ttl deletes them.
 * Returns the number of rows resolved from a real response.
 */
CREATE OR REPLACE FUNCTION public.settle_workflow_dispatch_log()
RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_settled integer;
BEGIN
  UPDATE public.workflow_dispatch_log d
     SET status_code = r.status_code,
         error_msg   = nullif(r.error_msg, ''),
         settled_at  = now()
    FROM net._http_response r
   WHERE r.id = d.request_id
     AND d.settled_at IS NULL;
  GET DIAGNOSTICS v_settled = ROW_COUNT;

  -- pg_net answers in seconds, and this runs every 15 minutes, so 90 minutes with no
  -- response row means the request never completed — distinct from "GitHub said no", and
  -- exactly the shape of the 09-15 miss. Far inside the 6h ttl, so a pruned row can never
  -- be misread as a lost one.
  UPDATE public.workflow_dispatch_log
     SET settled_at = now(),
         error_msg  = 'no pg_net response — the request never completed'
   WHERE settled_at IS NULL
     AND dispatched_at < now() - interval '90 minutes';

  -- 18 jobs is a few dozen rows a day; 90 days is a full quarter of history for nothing.
  DELETE FROM public.workflow_dispatch_log
   WHERE dispatched_at < now() - interval '90 days';

  RETURN v_settled;
END;
$function$;

-- cron.schedule upserts on the name, so re-running this file is safe. Every 15 minutes is
-- well inside pg_net's 6h ttl even if several consecutive runs are skipped.
SELECT cron.schedule('settle-workflow-dispatch-log', '*/15 * * * *',
                     $job$SELECT public.settle_workflow_dispatch_log()$job$);
