-- Migration 091: search_health_events — telemetry log for Typesense search failures
-- seen by real browsers (the map-terminal "Search Error / timeout of 15000ms exceeded"
-- mode, 2026-07-20). The terminal talks to Typesense Cloud directly, so Vercel logs
-- never see these failures; this table is the only place they become visible.
--
-- Written by POST /api/telemetry/search-timeout (rate-limited, anonymous — session_id
-- is a random per-tab UUID, no PII). The same route evaluates alert thresholds
-- (src/lib/telemetry/searchHealthPolicy.ts) and emails the owner when flakiness is
-- sustained; kind='alert_sent' rows record those sends and drive the cooldown.
-- Rows older than 30 days are pruned opportunistically by the route.
--
-- RLS enabled with NO policies = service-role only (same pattern as listing_alerts 051).
-- Run: npx tsx scripts/admin/applyMigrationFiles.ts 091_search_health_events.sql

CREATE TABLE IF NOT EXISTS public.search_health_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 'timeout' | 'network' | 'http_error' | 'alert_sent'
  kind TEXT NOT NULL,
  -- How long the failed request ran before dying (ms), when known.
  duration_ms INTEGER,
  -- Random per-browser-tab UUID — distinguishes "one user's broken connection"
  -- from "everyone is down" without identifying anyone.
  session_id TEXT,
  -- Small free-form context from the client (page, filter summary, error message).
  context JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS search_health_events_occurred
  ON public.search_health_events (occurred_at DESC);

ALTER TABLE public.search_health_events ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.search_health_events IS
  'Browser-reported Typesense search failures (terminal timeout telemetry) + alert_sent markers. Service-role only; 30-day retention enforced by the telemetry route.';
