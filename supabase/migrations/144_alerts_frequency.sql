-- 144 — how often the nightly digest actually sends.
--
-- The digest had exactly two states: on, or off. A reader who found it too frequent had one
-- control available in the email, and it was Unsubscribe. 46 of 505 profiles have taken it
-- (9.1%), measured 2026-09-12.
--
-- Deliberately NOT email_prefs.cadence. That column spaces the onboarding drip and gates the
-- weekly Data Drop, and sendPolicy's own rule is that a preference means the words the user
-- read beside it — overloading cadence would silently change the digest for anyone who had
-- set a drip spacing, which is the quiet months-later failure this codebase keeps producing.
--
-- Default 'daily' preserves today's behaviour for every existing row AND every missing one
-- (migration 106's opt-out model). Nothing is flipped server-side: weekly is a choice the
-- reader makes, in one click, from the email itself. Same refusal as 095's — a change the
-- user did not ask for and cannot see reads as broken delivery, not as courtesy.
alter table public.email_prefs
  add column if not exists alerts_frequency text not null default 'daily';

alter table public.email_prefs
  drop constraint if exists email_prefs_alerts_frequency_check;

alter table public.email_prefs
  add constraint email_prefs_alerts_frequency_check
  check (alerts_frequency in ('daily', 'weekly'));

comment on column public.email_prefs.alerts_frequency is
  'Nightly digest frequency: daily (default) or weekly. Set in one click from the digest footer via /api/email/alert-frequency. On a skipped night the worker HOLDS market_bubbles.notify_since so the week accumulates instead of collapsing to the last night — see scripts/worker/alerts.ts.';
