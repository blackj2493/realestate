-- Migration 025: Market Bubbles (saved custom areas)
-- Purpose: persist user-defined custom areas (draw / commute / school) as
-- first-class objects so they can drive saved-search dashboard cards.
--
-- Sign-in gated by design (no anonymous localStorage fallback, unlike the
-- watchlist) — saving a bubble is the first feature that requires an account.
--
-- NEW TABLE ONLY. Does NOT touch raw_vow_sold / listings / sync_state (CLAUDE.md §12).
--
-- Apply manually:
--   psql "$DATABASE_URL" -f supabase/migrations/025_market_bubbles.sql
-- (DATABASE_URL must be the Supabase Session pooler string — the direct host is
-- IPv6-only and unreachable from this environment; see CLAUDE.md §12.)

-- ── market_bubbles ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.market_bubbles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  area_type   TEXT NOT NULL CHECK (area_type IN ('draw', 'commute', 'school')),
  -- Polygon ring as JSONB array of [lat, lng] pairs. Schema-flexible because
  -- draw / isochrone / synthesized-circle all produce different vertex counts.
  polygon     JSONB NOT NULL,
  -- Inputs that produced the polygon — kept so we can re-derive on schema
  -- changes (e.g. school point + radius, isochrone destination + minutes).
  source      JSONB,
  -- Serialized commandCenterStore filter slice (persona, beds, price band, etc.)
  filters     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_market_bubbles_user
  ON public.market_bubbles (user_id, created_at DESC);

ALTER TABLE public.market_bubbles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "market_bubbles_select_own" ON public.market_bubbles
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "market_bubbles_insert_own" ON public.market_bubbles
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "market_bubbles_update_own" ON public.market_bubbles
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "market_bubbles_delete_own" ON public.market_bubbles
  FOR DELETE TO authenticated USING (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.market_bubbles TO authenticated;

-- ── 10-per-user cap (insert trigger) ────────────────────────────────────────
-- Bounds IO on /api/bubbles/[id]/stats (each card is an on-demand polygon
-- query against Typesense + Supabase). Enforced server-side so the client can't
-- bypass via direct REST.
CREATE OR REPLACE FUNCTION public.enforce_bubble_cap()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF (SELECT COUNT(*) FROM public.market_bubbles WHERE user_id = NEW.user_id) >= 10 THEN
    RAISE EXCEPTION 'bubble_cap_reached: each account can save at most 10 market bubbles';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_bubble_cap ON public.market_bubbles;
CREATE TRIGGER enforce_bubble_cap
  BEFORE INSERT ON public.market_bubbles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_bubble_cap();

-- ── updated_at maintenance ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.touch_market_bubble()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS touch_market_bubble ON public.market_bubbles;
CREATE TRIGGER touch_market_bubble
  BEFORE UPDATE ON public.market_bubbles
  FOR EACH ROW EXECUTE FUNCTION public.touch_market_bubble();

COMMENT ON TABLE public.market_bubbles IS
  'User-owned saved custom areas (draw/commute/school). polygon = [[lat,lng],...]. RLS: owner-only via auth.uid(). Capped at 10/user.';
