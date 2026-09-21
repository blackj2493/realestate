-- 146 — separate "the reader chose daily" from "nobody ever said".
--
-- Migration 144 added `alerts_frequency text not null default 'daily'`. That default is
-- correct for behaviour and ambiguous for intent: a row created by ANY other write — the
-- "Pause for 30 days" link, or a save on /account/emails — is filled in with 'daily' without
-- the reader ever touching the frequency. Two of the three rows in production on 2026-09-21
-- are exactly that shape, both created by a pause click.
--
-- That ambiguity matters now, because 146 is the prerequisite for deriving a cadence for
-- readers who have not chosen one (src/lib/email/digestCadence.ts). Without it the rule
-- cannot tell a reader who pressed "Go back to a nightly email" from a reader who pressed
-- nothing, and it would re-cap someone who had already overruled it. A preference the
-- product quietly re-applies is worse than no preference at all.
--
-- NULLABLE ON PURPOSE, and null is the common case. It means "never chosen", which is the
-- state every existing row is in and the state that lets the default rule apply. Only
-- /api/email/alert-frequency writes it, and it writes it for BOTH actions — choosing daily
-- is as much a decision as choosing weekly, and it is the one that must survive.
--
-- No backfill. Stamping the existing rows would assert a choice nobody made, which is the
-- exact error this column exists to prevent.
alter table public.email_prefs
  add column if not exists alerts_frequency_chosen_at timestamptz;

comment on column public.email_prefs.alerts_frequency_chosen_at is
  'When the reader last chose alerts_frequency themselves, via the one-click links in the digest footer. NULL means they never have, and the derived cadence in src/lib/email/digestCadence.ts may apply. Never backfilled: a stamp asserts a decision, and 144''s default value is not one.';
