-- Migration 014: Create terminal_applications table
-- Purpose: Persist "velvet rope" access applications submitted at /apply.
--
-- The app is anonymous (no auth wired). This table is lead capture AND the source
-- of the personalization seed the home dashboard reads (regions/objectives). Access
-- gating itself is client-side (localStorage) per the V1 plan — this table does not
-- gate anything. New table only — does NOT touch raw_vow_sold (CLAUDE.md §12).
--
-- Writes go through getServiceRoleClient() in /api/onboarding/apply (bypasses RLS).
-- RLS is enabled with NO policies so the public anon key cannot read applicant PII
-- (name/email) — Supabase grants anon access to RLS-disabled public tables by default.

CREATE TABLE IF NOT EXISTS terminal_applications (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  applicant_type   TEXT,
  full_name        TEXT,
  email            TEXT,
  entity_name      TEXT,
  objectives       TEXT[] DEFAULT '{}',
  regions          TEXT[] DEFAULT '{}',
  capital          TEXT,
  assets           TEXT[] DEFAULT '{}',
  cadence          TEXT,
  attest_not_agent BOOLEAN DEFAULT false,
  attest_bona_fide BOOLEAN DEFAULT false,
  agree_terms      BOOLEAN DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_terminal_applications_email
  ON terminal_applications (email);

CREATE INDEX IF NOT EXISTS idx_terminal_applications_created_at
  ON terminal_applications (created_at DESC);

-- Lock the table down: no anon/authenticated access; only the service role (which
-- bypasses RLS) can insert. No policies are added intentionally.
ALTER TABLE terminal_applications ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE terminal_applications IS
  'Velvet-rope access applications from /apply. Lead capture + dashboard personalization seed. RLS on with no policies (service-role writes only). Anonymous app — not an auth table.';
