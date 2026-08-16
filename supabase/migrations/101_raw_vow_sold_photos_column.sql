-- 101_raw_vow_sold_photos_column.sql
--
-- DB audit 2026-07-27, step 3 (part 1 of 2: ADDITIVE ONLY — nothing is removed here).
--
-- raw_vow_sold.raw_payload is 4,152 MB of the 4,539 MB table, and the `media` array is
-- most of it: ~37 photo objects per sold listing, each an 8-field record where only
-- three fields carry information.
--
-- Measured across the sampled media elements:
--   MediaCategory         always 'Photo'    (constant — dropped)
--   ImageSizeDescription  always 'Medium'   (constant — dropped)
--   MediaKey/MediaObjectID  unique ids, read by nothing (dropped)
--   MediaStatus           'Active' | 'Deleted' — 17.3% are Deleted, and
--                         src/lib/etl/selectPrimaryImage.ts:collectMediaUrls already
--                         skips them, so they were stored but never renderable.
--   Order                 preserved implicitly by array position
--   MediaURL              the actual payload
--   ShortDescription      a caption on 8.3% of photos — KEPT, since sold detail
--                         pages will want it
--
-- This column stores the useful residue: Active photos only, deduplicated by URL,
-- in Order, as [{"u": <url>}, {"u": <url>, "c": <caption>}, ...].
--
-- Dedupe + Deleted-filter deliberately mirror collectMediaUrls() exactly so the sold
-- path and the active-listing path agree on what "the photos" are.
--
-- Sizing: once raw_payload.media is removed in part 2, raw_vow_sold goes
-- 4,539 MB -> ~3,342 MB (-17.1%), preserving an average of 32.7 photos per listing.
--
-- Adding a nullable column with no default is catalogue-only in PG11+ — no table
-- rewrite, no lock beyond a brief ACCESS EXCLUSIVE. Backfill is a separate batched
-- script (scripts/admin/backfillSoldPhotos.ts) so it can be paced and resumed.
--
-- Rollback: ALTER TABLE public.raw_vow_sold DROP COLUMN photos;

ALTER TABLE public.raw_vow_sold
  ADD COLUMN IF NOT EXISTS photos jsonb;

COMMENT ON COLUMN public.raw_vow_sold.photos IS
  'Active, deduplicated listing photos in display order: [{"u":url,"c":caption?}]. '
  'Replaces raw_payload->''media'' (migration 101/102). Mirrors collectMediaUrls() '
  'semantics: MediaStatus=Deleted excluded, duplicates removed, Order preserved.';

INSERT INTO public.schema_migrations (filename, applied_via)
VALUES ('101_raw_vow_sold_photos_column.sql', 'apply')
ON CONFLICT DO NOTHING;
