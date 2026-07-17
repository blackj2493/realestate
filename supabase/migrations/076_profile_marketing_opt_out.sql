-- 076_profile_marketing_opt_out.sql
-- Registered-user marketing/nurture email opt-out, for CASL + RFC 8058 one-click
-- unsubscribe on the welcome (and future nurture) emails. Additive and safe:
-- nullable-with-default boolean, so every existing row stays opted-in (false) and no
-- query that reads profiles is affected. Idempotent (IF NOT EXISTS) so re-apply is a no-op.
--
-- Transactional mail (OTP, and watchlist alerts the user actively saved) is intentionally
-- NOT gated by this flag — it only governs promotional/nurture sends.

alter table public.profiles
  add column if not exists marketing_opt_out    boolean     not null default false,
  add column if not exists marketing_opt_out_at  timestamptz;

comment on column public.profiles.marketing_opt_out is
  'True once the user one-click-unsubscribed from marketing/nurture email (welcome, feature nurture). Does not affect transactional mail (OTP, saved-watchlist alerts).';
