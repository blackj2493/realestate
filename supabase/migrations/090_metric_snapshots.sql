-- 090 — metric_snapshots: nightly history for DRIFT detection.
--
-- The data-health canary (087) catches metrics that go null, stale, out-of-range or
-- unapplied. It cannot catch the remaining class: a metric that is WRONG BUT PLAUSIBLE —
-- a subtly bad formula, a join that silently widens, a filter that stops filtering. Those
-- land inside every range check and look completely normal in isolation.
--
-- What gives them away is MOVEMENT. region_metrics is recomputed nightly from trailing
-- windows, so a healthy market barely moves night over night: a median price does not jump
-- 20% overnight, active inventory does not halve. A large single-night move is therefore a
-- code/data event, not a market event.
--
-- This table stores one row per (day, region, metric) so the canary can diff last night's
-- run against tonight's. Deliberately narrow and numeric — it is a monitoring signal, not
-- an analytics store.
--
-- Month-rollover caveat handled by the checker: price metrics describe the LATEST month,
-- which is genuinely volatile in its first days (few sales). The snapshot therefore also
-- records `latestMonthKey` (YYYYMM as a number) per region, and month-sensitive metrics are
-- compared only when that key is unchanged.

CREATE TABLE IF NOT EXISTS metric_snapshots (
  captured_on date    NOT NULL,
  region      text    NOT NULL,
  metric      text    NOT NULL,
  value       numeric,
  PRIMARY KEY (captured_on, region, metric)
);

-- The canary's only read pattern: "the most recent day before today".
CREATE INDEX IF NOT EXISTS idx_metric_snapshots_day
  ON metric_snapshots (captured_on DESC);

COMMENT ON TABLE metric_snapshots IS
  'Nightly per-region metric values, written by scripts/worker/dataHealthCheck.ts, used to detect night-over-night DRIFT (the wrong-but-plausible failure class that range checks cannot see). Pruned to ~400 days by the canary.';
