-- 159_optout_partial_indexes.sql
--
-- Partial indexes over the seller opt-out rows, so the daily opt-out purge
-- (scripts/admin/purgeInternetDisplayOptOuts.ts, optout-purge.yml) stops reading the
-- whole payload of both big tables every day.
--
-- WHY. The purge finds opted-out keys with
--     listings:     full_payload->>'InternetEntireListingDisplayYN' = 'false'
--     raw_vow_sold: raw_payload->>'InternetEntireListingDisplayYN' = 'false'
--                OR raw_payload->>'InternetAddressDisplayYN' = 'false'
-- With no index, each is a full detoast of a 5+ GB jsonb column: ~4 min each, ~10 GB of
-- disk reads a day, 610 GB since 2026-07-28 (the #2 disk reader after the street ledger,
-- fixed by 158). The purge baseline on 2026-10-24 took 10.5 min end to end.
--
-- HOW. Each index holds ONLY the opted-out rows (~1.2k and ~5.4k), keyed by listing_key.
-- The planner uses a partial index only when the query's WHERE implies the index
-- predicate, so the predicates below are copied VERBATIM from the purge script's
-- literal SQL. Change one, change the other (the script says so too).
--
-- WRITE COST. Both tables already carry expression indexes on the payload column
-- (idx_listings_county_lower, idx_vow_sold_county_lower), so a payload change is already
-- a non-HOT update; these add a predicate check per write and a tiny index.
--
-- APPLY. CREATE INDEX CONCURRENTLY cannot run in a transaction block. Run each statement
-- SEPARATELY in the SQL Editor. Each build reads the payload column once (minutes).

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_listings_optout_display
  ON public.listings (listing_key)
  WHERE full_payload->>'InternetEntireListingDisplayYN' = 'false';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vow_sold_optout_display
  ON public.raw_vow_sold (listing_key)
  WHERE raw_payload->>'InternetEntireListingDisplayYN' = 'false'
     OR raw_payload->>'InternetAddressDisplayYN' = 'false';
