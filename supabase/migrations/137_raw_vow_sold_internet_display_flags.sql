-- 137: raw_vow_sold.internet_display_optout / internet_address_optout —
-- stop reading the seller's opt-out out of jsonb on a request path.
--
-- The two switches ("Distribute to Internet" / "Display Address on Internet",
-- migration-free until now) live inside raw_payload with no index. Reading them is
-- a detoast per row, which is fine for the single-key archive lookups in
-- soldByKey.ts and fatal for anything that scans:
--
--     1,000 rows, WHERE transaction_type / purchase_contract_date, ORDER BY listing_key
--       flat columns only            offset 0 →   580 ms   offset 45,000 → 1,365 ms
--       + the two raw_payload->>     offset 0 →   790 ms   offset 45,000 → STATEMENT TIMEOUT
--
-- purgeInternetDisplayOptOuts.ts says the same thing in its own header: "the flags
-- live inside jsonb with no index, so each census query is a full scan and takes
-- minutes. That is why this is an admin script and not a request-path check."
--
-- /addresses/sitemap.xml now needs exactly that check on a request path — it must
-- never declare a URL for a listing whose seller opted out of internet display — so
-- the flags get the same treatment migration 104 gave transaction_type: promote them
-- to real columns and read those.
--
-- NULLABLE ON PURPOSE, and the readers require an explicit `false`. A NULL means
-- "not backfilled yet", so an un-backfilled row is EXCLUDED rather than published.
-- A compliance flag must fail safe: the cost of a NULL default of `false` is
-- publishing an address the seller asked us to hide.
--
-- No index. An explicit No is ~0.9% of the table (4,973 of 541,420), so the planner
-- would never choose one; the predicate rides along on the scan the sitemap already
-- does. Same reasoning as 104.
--
-- DDL only. The backfill is batched in scripts/admin/backfillSoldInternetDisplay.ts
-- so it can pace itself and VACUUM as it goes (the table is ~3.4 GB; one whole-table
-- UPDATE would need a second copy of the heap).

ALTER TABLE public.raw_vow_sold
  ADD COLUMN IF NOT EXISTS internet_display_optout  boolean,
  ADD COLUMN IF NOT EXISTS internet_address_optout  boolean;

COMMENT ON COLUMN public.raw_vow_sold.internet_display_optout IS
  'TRUE when the feed carries an explicit No for InternetEntireListingDisplayYN '
  '("Distribute to Internet") — the seller opted the whole listing out of internet '
  'display. NULL means not yet backfilled: readers must require an explicit false, '
  'never treat NULL as "not opted out". Mirrors isListingDisplayOptedOut() in '
  'src/lib/compliance/internetDisplay.ts; written on every upsert by '
  'scripts/worker/ingester.ts, backfilled by scripts/admin/backfillSoldInternetDisplay.ts.';

COMMENT ON COLUMN public.raw_vow_sold.internet_address_optout IS
  'TRUE when the feed carries an explicit No for InternetAddressDisplayYN ("Display '
  'Address on Internet") — the seller opted the ADDRESS out while the listing itself '
  'may still be displayable. Either switch suppresses the /address page, which exists '
  'to publish an address. Same NULL semantics as internet_display_optout.';
