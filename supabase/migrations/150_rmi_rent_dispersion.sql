-- 150: the rent cohort's own interquartile spread, so a surface can tell a tight cohort
-- from a wide one.
--
-- WHY. Backtested 2026-09-25 on 38,301 held-out closed leases. The ladder's median error is
-- 5.45% and 1.13% of its answers are more than 50% wrong. Three attempts to FIX that tail by
-- regrouping the comps geographically all measured worse or neutral, because where the ladder
-- blows up a radius cohort blows up too 64% of the time. The tail is not a grouping artifact.
-- It is properties whose comps genuinely disagree.
--
-- Dispersion finds them. Measured lift on the same held-out set:
--
--   flag                      flags    blow-rate in   out      lift
--   (p75-p25)/median > 0.5     1.46%        18.13%     0.87%   16.1x
--   sample_count < 10         35.12%         1.86%     0.73%    1.65x
--
-- Sample count is nearly useless as a discriminator, which is why an earlier attempt to gate
-- thin rungs made accuracy WORSE. Spread is the signal. Blow-ups run a median (p75-p25)/median
-- of 0.237 against 0.096 for every other row.
--
-- Stored as the raw quartiles rather than a precomputed ratio so the threshold can move
-- without a full index rebuild, and so a future surface can show the range itself.
--
-- NULLABLE ON PURPOSE. Every existing row reads NULL until the next
-- `refreshRentalMarketIndex --apply`, and rentTierConfidence() treats NULL as "unknown, do
-- not flag". So this migration alone changes nothing that renders — the gate turns on when
-- the index is rebuilt, not when the column appears. Migration 148 taught us what a
-- half-applied index change costs.
ALTER TABLE rental_market_index
  ADD COLUMN IF NOT EXISTS p25_rent integer,
  ADD COLUMN IF NOT EXISTS p75_rent integer;

COMMENT ON COLUMN rental_market_index.p25_rent IS
  '25th-percentile monthly rent in this cohort. With p75_rent gives the spread behind avg_rent: (p75-p25)/avg_rent > 0.5 marks a cohort whose median is not a reliable point estimate (16x blow-up lift, migration 150).';
COMMENT ON COLUMN rental_market_index.p75_rent IS
  '75th-percentile monthly rent in this cohort. See p25_rent.';
