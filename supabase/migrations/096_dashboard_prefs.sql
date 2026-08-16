-- 096: dashboard_prefs — server-side home for the dashboard config so a signed-in
-- user's saved areas / activity filters / persona follow them across devices.
--
-- WHY (owner report 2026-07-24): the entire DashboardConfig (regions, Market
-- Activity lens, boards, persona, lastVisitAt) lived ONLY in localStorage, so
-- every device had its own divergent dashboard even when signed in. Saved
-- bubbles were already server-side (market_bubbles) — this brings the rest.
--
-- One jsonb row per user; the client normalizes on read (normalizeConfig), so
-- schema evolution stays in TypeScript. Sync model: server wins on load,
-- last-writer-wins on edit (debounced PUT). RLS owner-only, same idiom as 025.

CREATE TABLE IF NOT EXISTS public.dashboard_prefs (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  config     jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.dashboard_prefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dashboard_prefs_select_own" ON public.dashboard_prefs
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "dashboard_prefs_insert_own" ON public.dashboard_prefs
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "dashboard_prefs_update_own" ON public.dashboard_prefs
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "dashboard_prefs_delete_own" ON public.dashboard_prefs
  FOR DELETE USING (auth.uid() = user_id);

COMMENT ON TABLE public.dashboard_prefs IS
  'Per-user DashboardConfig (regions, Market Activity lens, boards, persona, lastVisitAt) as one jsonb blob. Client normalizes on read; server wins on load, last-writer-wins on edit. RLS owner-only.';
