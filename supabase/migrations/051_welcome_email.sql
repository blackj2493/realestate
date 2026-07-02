-- 051_welcome_email.sql — lifecycle welcome email support.
--
-- Additive only (safe to run anytime; new nullable columns on public.profiles):
--   welcome_sent_at  — idempotency watermark; set once the welcome email is sent
--                      (or skipped for an opted-out user), so it never double-sends.
--   signup_intent    — the area the user was viewing pre-signup (captured client-side
--                      at the sign-in wall), e.g. {"label":"Madawaska Valley",
--                      "slug":"madawaska-valley","prov":"on"}. Powers the personalized
--                      welcome; NULL → generic welcome.
--   email_opt_out    — CASL unsubscribe flag. When true, we send no marketing email.

alter table public.profiles
  add column if not exists welcome_sent_at timestamptz,
  add column if not exists signup_intent jsonb,
  add column if not exists email_opt_out boolean not null default false;
