-- 155_address_watch_recap.sql
--
-- "Track this home" now asks before it adds the monthly Street Recap: a tick-box beside the
-- listing alert, unticked by default. This column records the answer.
--
-- WHY A QUESTION, NOT A DEFAULT. The alert is what a watcher came for. The recap is a second
-- email they did not ask for by tracking a home, and CASL does not count a pre-ticked box as
-- consent. So every new row carries an explicit true/false.
--
-- NULL means "never asked". The worker (src/lib/streetRecap/data.ts) mails `recap = true`
-- only, so a NULL row never gets a recap.
--
-- THE BACKFILL, AND ITS CUTOFF. Every watch made before this change was made under card copy
-- that promised the recap ("A monthly note on what actually sells near here"), so those
-- watchers keep it. The cutoff is a FIXED time rather than now(): the new card cannot be live
-- before this file was written, so every row older than it was made under the old copy. If
-- the new code deploys before this file is applied, /api/address-watches saves the watch
-- without the column (see its fallback), and those rows stay NULL, which errs towards
-- sending LESS, never more.
--
-- APPLY THIS BEFORE MERGING the change that ships the new card. Until it is applied, the
-- route cannot store the answer.

ALTER TABLE public.address_watches
  ADD COLUMN IF NOT EXISTS recap BOOLEAN;

COMMENT ON COLUMN public.address_watches.recap IS
  'Monthly Street Recap opt-in from the Track this home card. true = send, false = declined, NULL = never asked (not sent). Rows made before 2026-10-12 19:30 UTC were backfilled true: the old card promised the recap.';

UPDATE public.address_watches
   SET recap = true
 WHERE recap IS NULL
   AND created_at < TIMESTAMPTZ '2026-10-12 19:30:00+00';
