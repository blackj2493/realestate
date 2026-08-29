-- 130_avm_cohort_rung.sql
--
-- Adds the cohort RUNG to the AVM matrix and audit tables, so a trained cohort can be keyed
-- on a community, a postal FSA, or a whole city instead of only a community.
--
-- WHY. Until now a cohort was keyed on city_region alone, and every consumer dropped any row
-- without one. That silently removed whole markets from the model. Waterloo Region and
-- Brantford ship a blank CityRegion on both the sold and the active side, so 10,681 sales
-- never reached the trainer — and Kitchener still returned an AVM value for 1,291 of 1,292
-- actives, not one of which has ever reached HIGH confidence, against 33% of the rest of the
-- book. A missing INPUT, not a failed output. Chatham-Kent proved the cause is the KEY and
-- not that one feed: its CityRegion is populated, but 200 sales across 26 communities means
-- no community ever trains, and the same guard dropped it.
--
-- Measured 2026-08-29 at the trainer's real settings (36 months, min-samples 40):
--   FSA rung   → 61 new cohorts, recovers 8,992 of 11,281 blank-CityRegion sales (80%)
--   city rung  → 16 more cohorts, recovers a further 1,158 (10%)
--   residual   → 1,131 sales genuinely too thin for any rung; those stay anchor-only.
--
-- THE UNIQUE KEYS MUST MOVE WITH IT. 67 city names collide with an existing city_region
-- spelling — 'Ajax' the community and 'Ajax' the city are different cohorts that would land
-- on the same row. The old uniqueness (city_region, property_sub_type[, feature_name]) turns
-- that into a constraint violation the moment the city rung trains, so the rung joins the
-- key rather than being bolted on beside it.
--
-- The DEFAULT is 'community', which is exactly right for every row that exists today: they
-- were all trained on city_region. Nothing is reinterpreted by this migration.
--
-- NOTE for the next reader: scripts/worker/avm/promoteChallenger.ts copies staging -> live
-- with an EXPLICIT column list. A column added here without touching that file would silently
-- default to 'community' in live, and every FSA cohort would masquerade as a community one.
-- The same change set updates it.

-- 1. the column
ALTER TABLE public.avm_multiplier_matrix
  ADD COLUMN IF NOT EXISTS cohort_rung text NOT NULL DEFAULT 'community';
ALTER TABLE public.avm_multiplier_matrix_staging
  ADD COLUMN IF NOT EXISTS cohort_rung text NOT NULL DEFAULT 'community';
ALTER TABLE public.avm_audit_report
  ADD COLUMN IF NOT EXISTS cohort_rung text NOT NULL DEFAULT 'community';
ALTER TABLE public.avm_audit_report_staging
  ADD COLUMN IF NOT EXISTS cohort_rung text NOT NULL DEFAULT 'community';

-- 2. only the three rungs the ladder defines (src/lib/avm/normalizeType.ts, cohortRungKeys)
DO $rungs$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['avm_multiplier_matrix', 'avm_multiplier_matrix_staging',
                           'avm_audit_report', 'avm_audit_report_staging'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = t || '_cohort_rung_check' AND conrelid = ('public.' || t)::regclass
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (cohort_rung IN (''community'',''fsa'',''city''))',
        t, t || '_cohort_rung_check');
    END IF;
  END LOOP;
END
$rungs$;

-- 3. the rung joins the uniqueness. Drop the old key whether it exists as a constraint or a
--    bare index, then create the replacement.
ALTER TABLE public.avm_multiplier_matrix
  DROP CONSTRAINT IF EXISTS avm_multiplier_matrix_city_region_property_sub_type_feature_key;
DROP INDEX IF EXISTS public.avm_multiplier_matrix_city_region_property_sub_type_feature_key;
CREATE UNIQUE INDEX IF NOT EXISTS avm_multiplier_matrix_rung_cohort_feature_key
  ON public.avm_multiplier_matrix (cohort_rung, city_region, property_sub_type, feature_name);

ALTER TABLE public.avm_multiplier_matrix_staging
  DROP CONSTRAINT IF EXISTS avm_multiplier_matrix_staging_city_region_property_sub_type_key;
DROP INDEX IF EXISTS public.avm_multiplier_matrix_staging_city_region_property_sub_type_key;
CREATE UNIQUE INDEX IF NOT EXISTS avm_multiplier_matrix_staging_rung_cohort_feature_key
  ON public.avm_multiplier_matrix_staging (cohort_rung, city_region, property_sub_type, feature_name);

ALTER TABLE public.avm_audit_report
  DROP CONSTRAINT IF EXISTS avm_audit_report_city_region_property_sub_type_key;
DROP INDEX IF EXISTS public.avm_audit_report_city_region_property_sub_type_key;
CREATE UNIQUE INDEX IF NOT EXISTS avm_audit_report_rung_cohort_key
  ON public.avm_audit_report (cohort_rung, city_region, property_sub_type);

ALTER TABLE public.avm_audit_report_staging
  DROP CONSTRAINT IF EXISTS avm_audit_report_staging_city_region_property_sub_type_key;
DROP INDEX IF EXISTS public.avm_audit_report_staging_city_region_property_sub_type_key;
CREATE UNIQUE INDEX IF NOT EXISTS avm_audit_report_staging_rung_cohort_key
  ON public.avm_audit_report_staging (cohort_rung, city_region, property_sub_type);

-- 4. the live lookup filters by rung as well as by cohort, so the read index carries it too.
--    The old (city_region, property_sub_type) indexes stay: they still serve the community
--    rung, which is every row until the first retrain runs.
CREATE INDEX IF NOT EXISTS idx_avm_matrix_rung_region_type
  ON public.avm_multiplier_matrix (cohort_rung, city_region, property_sub_type);

COMMENT ON COLUMN public.avm_multiplier_matrix.cohort_rung IS
  'Which geography this cohort is keyed on: community (city_region), fsa (postal FSA) or '
  'city. Finest first — see cohortRungKeys in src/lib/avm/normalizeType.ts, which is the '
  'single definition shared by the trainer, the trend job and the live matrix lookup.';
