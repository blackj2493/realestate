-- 156_pg_cron_street_recap.sql
--
-- Arms the monthly Street Recap (.github/workflows/street-recap.yml): the 2nd of every month
-- at 12:10 UTC, through the same pg_cron → workflow_dispatch path as migrations 127/128/139.
--
-- WHY THE 2ND. The recap reports the month BEFORE (the worker computes the window itself),
-- and sold data for a month keeps arriving for a few days after it ends. The 2nd is early
-- enough to be timely and late enough to be near-complete — the reasoning street-recap.yml
-- already records.
--
-- WHY 12:10 UTC. 08:10 in Toronto through the summer, 07:10 in winter: a home owner's
-- morning inbox, not the middle of the night. The minute is off :00 and off the jobs
-- already near it (daily-metrics 11:35, weekly-data-drop 11:40), so a slow
-- neighbour cannot delay it, and well clear of the 03:17 sync.
--
-- THE DISPATCH CARRIES NO INPUTS, and that is what makes it a real send: dispatch_github_workflow
-- posts only {"ref":"main"}, so `dry_run` takes its default (false) and `test_to` is empty.
--
-- Arming checklist (street-recap.yml) — all three were true on 2026-10-21:
--   1. migration 130 (the aggregate RPCs) is applied;
--   2. a real send went out by hand and was read (run 39598141506, owner layout #637);
--   3. reno_lookups + address_watches resolve 37 of 37 recipients (dry run 39598302615).
-- The same change sets `armedBy` for home_value in src/lib/email/streams.ts and registers
-- the workflow in schedule-watchdog.yml.

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
SELECT cron.schedule('dispatch-street-recap', '10 12 2 * *',
                     $job$SELECT public.dispatch_github_workflow('street-recap.yml')$job$);

-- Verify:
--   SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'dispatch-street-recap';
--   SELECT id, status_code, error_msg, created FROM net._http_response ORDER BY id DESC LIMIT 5;
-- 204 is a successful dispatch; 401 means the PAT expired.
