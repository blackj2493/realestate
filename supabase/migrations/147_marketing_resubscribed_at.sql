-- 147 — when someone came BACK after unsubscribing.
--
-- 076 records the opt-out (`marketing_opt_out`, `marketing_opt_out_at`). Nothing records
-- the reverse, because until now there was no way to perform it: the unsubscribe
-- confirmation page was a dead end that said "You're unsubscribed" and offered a link to
-- the homepage. 14 readers took that exit in the eight days after the in-email controls
-- shipped, against 0 who chose "send this weekly" — so the moment of maximum intent was
-- also the moment we had nothing to offer.
--
-- The recovery page now offers two one-click alternatives, and clicking one is a NEW
-- consent event. CASL treats consent as something you must be able to evidence, and
-- clearing `marketing_opt_out` destroys the only timestamp on that row — so without this
-- column a resubscribe would erase its own audit trail. `marketing_opt_out_at` is left
-- untouched by the resubscribe for the same reason: the two stamps together say "opted out
-- at X, came back at Y", which is the sequence a regulator would ask about.
--
-- Additive, nullable, idempotent. Null means what it has always meant: this account has
-- never resubscribed.
alter table public.profiles
  add column if not exists marketing_resubscribed_at timestamptz;

comment on column public.profiles.marketing_resubscribed_at is
  'When the user re-consented to marketing email after unsubscribing, via a signed one-click link on the unsubscribe confirmation page (/api/email/alert-frequency, actions resub_weekly / resub_daily). Paired with marketing_opt_out_at, which is deliberately NOT cleared, so the row keeps the full consent sequence.';
