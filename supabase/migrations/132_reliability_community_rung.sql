-- 132_reliability_community_rung.sql
--
-- Pins region_avm_reliability() to the community rung.
--
-- WHY. Migration 130 added a cohort_rung to avm_audit_report, and the retrain on 2026-08-29
-- promoted a challenger that fills all three rungs: the table went from 1,685 rows to 3,516.
-- This function matches cohorts by `lower(a.city_region) IN (regionset)`, where regionset is
-- built from listings.city_region — so a CITY-rung row whose key happens to equal a community
-- name matches too. There are 96 such (city_region, property_sub_type) pairs today: "Aylmer",
-- "Blue Mountains", "Brant", "Brighton", "Brockton" and the like, where the community and the
-- municipality share a name.
--
-- The effect is silent double counting on a PUBLIC endpoint (/api/market/avm-reliability):
-- cohort_count and sales_analyzed are inflated, and wavg_r2 / wavg_mae_pct are pulled toward
-- the coarser city cohort because they are weighted by total_sales_analyzed.
--
-- This is a regression introduced by the promotion, not by the reliability feature. The other
-- readers of avm_audit_report are pinned in the same change set (auditService, siblingModel,
-- loadCohortTree, avm-experiment); this is the one that lives in SQL.
--
-- The body is otherwise BYTE-IDENTICAL to what was deployed — only the cohort_rung predicate
-- is added. Verified against pg_get_functiondef before writing.

CREATE OR REPLACE FUNCTION public.region_avm_reliability(
  p_region   text,
  p_subtypes text[] DEFAULT NULL::text[]
)
RETURNS TABLE(cohort_count integer, sales_analyzed integer, wavg_r2 numeric, wavg_mae_pct numeric)
LANGUAGE sql
STABLE
SET statement_timeout TO '60s'
AS $function$
  WITH regionset AS (
    SELECT DISTINCT lower(city_region) AS cr
    FROM listings
    WHERE city_region IS NOT NULL
      AND (
        lower(city) = lower(p_region)
        OR lower(city_region) = lower(p_region)
        OR (
          lower(city) >= lower(p_region) || ' '
          AND lower(city) <  lower(p_region) || chr(33)
          AND lower(city) ~ ('^' || lower(p_region) || ' [cwe][0-9][0-9]$')
        )
      )
  )
  SELECT
    count(*)::int,
    coalesce(sum(a.total_sales_analyzed), 0)::int,
    round((sum(a.model_accuracy_score * a.total_sales_analyzed)
           / NULLIF(sum(a.total_sales_analyzed), 0))::numeric, 3),
    round((sum(a.average_error_margin * a.total_sales_analyzed)
           / NULLIF(sum(a.total_sales_analyzed), 0) * 100)::numeric, 1)
  FROM avm_audit_report a
  WHERE lower(a.city_region) IN (SELECT cr FROM regionset)
    -- Added by migration 132: a city-rung cohort keyed on a name that is ALSO a community
    -- would otherwise be counted a second time.
    AND a.cohort_rung = 'community'
    AND a.total_sales_analyzed > 0
    AND (p_subtypes IS NULL OR a.property_sub_type = ANY (p_subtypes));
$function$;
