-- 160: Census 2021 area facts for the listing page's "The area" card.
--
-- WHY. Buyers compare a home's surroundings on HouseSigma and Zolo, which show census
-- figures. We show only facts about PLACES (tenure, housing stock, commute, moves, costs,
-- income), never facts about protected grounds (Ontario Human Rights Code; TRESA).
--
-- Three parts, all written offline by scripts/worker/census/loadCensus.ts:
--   census_da          one row per Ontario dissemination area (DA), boundary in 4326.
--                      Used ONLY offline, to put a listing point in a DA.
--   census_da_area     the card's numbers per DA: the DA pooled with up to 4 nearest DAs in
--                      the same city, plus the city baseline (src/lib/census/areaFacts.ts).
--   listing_geo_flags.census_dauid
--                      the listing's DA, set beside the cached point by the loader backfill
--                      and by enrichGeoFlags on each nightly run.
-- The page reads one row by primary key. No spatial query at request time (§5 Disk-IO).
--
-- Who reads and writes it: service role only (worker + getListingDetail). Source:
-- Statistics Canada, Census 2021 (Open Licence, attribution on the card).
--
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS public.census_da (
  dauid    text PRIMARY KEY,
  csd_uid  text NOT NULL,
  geom     geometry(MultiPolygon, 4326) NOT NULL
);
CREATE INDEX IF NOT EXISTS census_da_gix ON public.census_da USING GIST (geom);

CREATE TABLE IF NOT EXISTS public.census_da_area (
  dauid        text PRIMARY KEY,
  csd_uid      text NOT NULL,
  facts        jsonb NOT NULL,
  computed_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.census_da ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.census_da_area ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.listing_geo_flags ADD COLUMN IF NOT EXISTS census_dauid text;

-- ── Data API grants (REQUIRED since 2026-10-30) ─────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.census_da TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.census_da_area TO service_role;

COMMENT ON TABLE public.census_da IS
  'Census 2021 dissemination area boundaries (Ontario), Statistics Canada Open Licence. Offline point-in-DA only.';
COMMENT ON TABLE public.census_da_area IS
  'Census 2021 area facts per DA (pooled with up to 4 neighbours) + city baseline. Facts about places only. See src/lib/census/areaFacts.ts.';
COMMENT ON COLUMN public.listing_geo_flags.census_dauid IS
  'Census 2021 DA that holds the cached block-level point (geom). NULL = no point or outside Ontario.';

INSERT INTO schema_migrations (filename, applied_via)
VALUES ('160_census_area.sql', 'sql-editor')
ON CONFLICT (filename) DO NOTHING;
