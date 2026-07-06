-- 054: "checked" provenance for Things to Know geo flags.
--
-- listing_geo_flags.flags = '[]' is ambiguous: it means EITHER "enriched and clean"
-- OR "no trustworthy block-level coord — the spatial predicates never ran" (the
-- enrichment writes [] in both cases so stale flags always clear; see
-- scripts/worker/enrichGeoFlags.ts). The listing page's "Checked & clear" state must
-- only claim a check that actually ran, so record that fact explicitly.
--
-- Backfill: a full `npx tsx scripts/worker/enrichGeoFlags.ts` run after deploy sets
-- checked correctly everywhere; until then every row reads false and the card keeps
-- its old (render-nothing) behaviour.

ALTER TABLE listing_geo_flags
  ADD COLUMN IF NOT EXISTS checked boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN listing_geo_flags.checked IS
  'true = spatial predicates ran against a trustworthy block-level coord; false = no usable coord (flags=[] means "unknown", not "clear")';
