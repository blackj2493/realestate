-- 161: Census 2021 facts per TRREB community, for the neighbourhood hub pages
-- (/property/{prov}/{city}/{neighbourhood}).
--
-- WHY. The hub page lists homes for sale and little else, so it is thin for search. The
-- same census facts as the listing page's "The area" card (migration 160) give each hub
-- text about the place, next to the city figures. Facts about PLACES only (tenure, housing
-- stock, commute, moves, costs, income), never facts about protected grounds.
--
-- HOW. A community has no census boundary. scripts/worker/census/loadCommunities.ts gives
-- each dissemination area to the community that holds most listing points in it
-- (listing_geo_flags.census_dauid + listings.city/city_region) and pools the DAs
-- (src/lib/census/communities.ts). One row per (TRREB City value, CityRegion value).
-- The page reads by those two values. No spatial query at request time.
--
-- Who reads and writes it: service role only (worker + the hub page). Source: Statistics
-- Canada, Census 2021 (Open Licence, attribution on the page).
--
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS public.census_community_area (
  city         text NOT NULL,
  city_region  text NOT NULL,
  csd_uid      text NOT NULL,
  das          integer NOT NULL,
  facts        jsonb NOT NULL,
  computed_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (city, city_region)
);

ALTER TABLE public.census_community_area ENABLE ROW LEVEL SECURITY;

-- ── Data API grants (REQUIRED since 2026-10-30) ─────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.census_community_area TO service_role;

COMMENT ON TABLE public.census_community_area IS
  'Census 2021 area facts per TRREB community (City + CityRegion), pooled from the DAs where the community holds most listing points. Facts about places only. See src/lib/census/communities.ts.';

INSERT INTO schema_migrations (filename, applied_via)
VALUES ('161_census_community_area.sql', 'sql-editor')
ON CONFLICT (filename) DO NOTHING;
