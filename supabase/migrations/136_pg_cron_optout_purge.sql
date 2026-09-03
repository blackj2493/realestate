-- 136_pg_cron_optout_purge.sql
--
-- Schedules the seller opt-out purge (.github/workflows/optout-purge.yml) daily at
-- 09:53 UTC, through the same pg_cron → workflow_dispatch path as migrations 127/128.
--
-- WHY IT HAS TO RECUR. The code gates added in PR #475 stop an opted-out listing from
-- ENTERING either Typesense collection. They cannot remove a document for a listing that
-- opts out AFTER it was indexed: the sync just stops upserting it, and the stale document
-- keeps serving a public page until sold_listings prunes it at 180 days. An owner who
-- asks for removal today would otherwise wait up to six months for the address page to
-- go dark. This job closes that window to a day.
--
-- The listing page needs no equivalent: getListingDetail reads Supabase and gates on
-- every request, so it goes dark as soon as the flag arrives in the payload.
--
-- WHY 09:53. The 03:17 sync must have ingested the day's flag changes first, and the
-- Wednesday 09:00 backfill must be past. It lands before the 10:41 data-health canary,
-- so a purge that breaks something is visible in the same morning's checks. No other
-- daily job holds this minute (03:17, 09:26, 10:41, and :28 every six hours).
--
-- The job runs the purge WITH --apply. Its dry run is the canary: a healthy system finds
-- nothing to delete, because the gates caught it upstream. A non-zero delete count in the
-- workflow log means a seller opted out after their listing was already indexed — which
-- is exactly the case this job exists for, not an error.
--
-- Same async caveat as migration 127: pg_net queues the POST and returns an id, so this
-- job reports success even if GitHub later refuses the call. To read the truth:
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
END
$guard$;

-- cron.schedule(job_name, ...) upserts on the name, so re-running this file retimes
-- rather than duplicates. The server clock is UTC.
SELECT cron.schedule('dispatch-optout-purge', '53 9 * * *',
                     $job$SELECT public.dispatch_github_workflow('optout-purge.yml')$job$);
