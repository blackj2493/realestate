"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/browser";

/**
 * useIsAuthed — client-side signed-in signal for VOW-display gating in the
 * terminal (CLAUDE.md §4 / VOW §6.2(f)).
 *
 * Starts `false` on purpose: the anon-safe default means we never flash gated
 * VOW-derived data (True DOM, distress flags) before the cookie session
 * resolves. It flips true once `getUser()` confirms a session and stays in sync
 * via `onAuthStateChange` (sign-in/out on another tab). ANON key only.
 */
export function useIsAuthed(): boolean {
  const [isAuthed, setIsAuthed] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    let active = true;

    supabase.auth.getUser().then(({ data }) => {
      if (active) setIsAuthed(!!data.user);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsAuthed(!!session?.user);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  return isAuthed;
}
