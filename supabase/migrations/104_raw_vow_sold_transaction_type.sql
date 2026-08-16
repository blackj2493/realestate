-- 104: raw_vow_sold.transaction_type — stop inferring "is this a sale?" from price.
--
-- The AVM's comp pulls filter `close_price >= 50000` (MIN_SALE_PRICE) to keep
-- lease "closings" out of sale comparables. That is a magnitude test standing in
-- for a categorical fact the feed states outright: raw_payload->>'TransactionType'
-- is populated on every row —
--
--     For Sale       255,820
--     For Lease       40,210
--     For Sub-Lease       10
--
-- Measured 2026-08-01, the proxy currently costs:
--   * 0 leases leak in   (no lease has closed at >= $50k, so it "works" today)
--   * 482 REAL SALES are wrongly excluded — vacant land, mobile/trailer, rural
--
-- So it is not broken, it is load-bearing on an assumption nothing enforces. The
-- active index already carries a lease listed at >= $100k; the first such closing
-- silently poisons every sale comparable in its area.
--
-- The value lives in raw_payload, but filtering 296k rows through a JSONB
-- extraction is far more expensive than a column read, which is why the proxy was
-- attractive in the first place. Promote it to a real column.
--
-- No index: 'For Sale' is 86% of the table, so an index on it would never be
-- chosen. The filter rides along on the existing city_region / purchase_contract_date
-- indexes that already narrow these queries.
--
-- DDL only. The backfill is batched in scripts/admin/backfillSoldTransactionType.ts
-- so it can pace itself and VACUUM as it goes (the table is ~3.4 GB; one
-- whole-table UPDATE would need a second copy of the heap).

ALTER TABLE public.raw_vow_sold
  ADD COLUMN IF NOT EXISTS transaction_type text;

COMMENT ON COLUMN public.raw_vow_sold.transaction_type IS
  'RESO TransactionType as fed ("For Sale" / "For Lease" / "For Sub-Lease"). '
  'Use this to separate sales from leases — never a close_price threshold. '
  'Backfilled from raw_payload by scripts/admin/backfillSoldTransactionType.ts; '
  'written on every upsert by scripts/worker/ingester.ts.';
