-- Migration 029: VOW Terms-of-Use acceptance on profiles
-- Records a Consumer's acceptance of the VOW Terms of Use + bona-fide-interest
-- attestation, tied to their auth user. The app enforces this server-side before
-- serving VOW data (see src/lib/auth/terms.ts), gated behind the VOW_ENFORCE_TERMS
-- env flag so it can be rolled out safely AFTER this migration is applied.
--
-- NEW COLUMNS ONLY on the existing profiles table (migration 015). Instant DDL —
-- safe to paste into the Supabase SQL editor. The existing "profiles_update_own"
-- RLS policy already lets a user write these on their own row.
--
-- Apply manually (no supabase CLI linked): paste into the Supabase SQL editor, or
--   psql "$DATABASE_URL" -f supabase/migrations/029_profile_vow_terms.sql

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS terms_accepted_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS terms_version      TEXT,
  ADD COLUMN IF NOT EXISTS bona_fide_attested BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.profiles.terms_accepted_at IS
  'When the user accepted the VOW Terms of Use (NULL = not yet accepted).';
COMMENT ON COLUMN public.profiles.terms_version IS
  'Version string of the Terms the user accepted (see CURRENT_TERMS_VERSION in src/lib/auth/terms.ts).';
COMMENT ON COLUMN public.profiles.bona_fide_attested IS
  'User attested a bona-fide interest in the purchase/sale/lease of real estate (VOW §6.3(k)).';
