-- 154: remember the one-time "narrow all of Toronto / Ottawa to a part" ask, per reader.
--
-- WHY. A reader who follows a whole city of 4,000-10,000 homes gets the firehose that
-- unsubscribed 35.5% of one-area Toronto followers (2026-10-04). Toronto and Ottawa are now
-- offered as parts (cityParts.ts); readers who signed up before that still follow the whole
-- city. The digest asks them, at most three times, to pick a part. This table is how the
-- worker knows how many times it has asked and whether the reader answered.
--
-- One row per reader and city. Written only by the service role (worker + the signed email
-- route + the session API route, which reads through the service role for its own user);
-- RLS on with no client policy, the same posture as signup_attribution (152).
--
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS public.area_narrow_asks (
  user_id        uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  -- The whole city being narrowed, exactly as saved ("Toronto", "Ottawa").
  city           text        NOT NULL,
  -- Emails that carried the ask. The worker stops at 3.
  shown_count    integer     NOT NULL DEFAULT 0,
  last_shown_at  timestamptz,
  -- The part suggested from the homes the reader opened, when there were enough of them.
  suggested_part text,
  -- 'switched' (picked a part) or 'kept' (chose to keep the whole city). NULL = unanswered.
  resolved       text        CHECK (resolved IN ('switched', 'kept')),
  resolved_part  text,
  resolved_via   text,       -- 'email' | 'app'
  resolved_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, city)
);

ALTER TABLE public.area_narrow_asks ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.area_narrow_asks IS
  'One-time ask to narrow a whole-city area (Toronto/Ottawa) to a part. Service role only. See src/lib/areas/narrowAsk.ts.';

INSERT INTO schema_migrations (filename, applied_via)
VALUES ('154_area_narrow_asks.sql', 'sql-editor')
ON CONFLICT (filename) DO NOTHING;
