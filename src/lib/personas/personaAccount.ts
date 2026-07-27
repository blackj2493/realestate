/**
 * Account-level persona mirror (best-effort, fire-and-forget).
 *
 * localStorage (the dashboard config) stays the fast path AND the single source of
 * truth for the active persona. This module additionally mirrors a CHANGED persona to
 * the signed-in user's Supabase metadata, and — for a user who is signed in but has no
 * local dashboard config yet (a fresh device) — adopts the persona stored on their
 * account so the terminal opens on their real lens instead of the Homebuyer default.
 *
 * Every path swallows errors: an auth / network hiccup must never block a lens switch.
 */
import { createClient } from "@/lib/supabase/browser";
import { asPersona } from "@/lib/personas/resolvePersona";
import type { PersonaType } from "@/lib/personas/personaConfig";
import { getConfig, saveConfig, hasStoredConfig } from "@/lib/dashboard/config";

/**
 * Persist the active persona to the signed-in user's account metadata (a no-op when
 * signed out). Called from config.saveConfig ONLY when the persona actually changed,
 * so region/board edits and per-visit stamps never trigger an auth write.
 */
export async function mirrorPersonaToAccount(persona: PersonaType): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const supabase = createClient();
    const { data } = await supabase.auth.getUser();
    if (!data.user) return; // signed out — localStorage is the only store
    if (asPersona(data.user.user_metadata?.persona) === persona) return; // already current
    await supabase.auth.updateUser({ data: { persona } });
  } catch {
    /* best-effort — the local store already has the change */
  }
}

/**
 * When the user is signed in but THIS device has no dashboard config yet, seed the
 * local config's persona from their account metadata. Local-first: an existing local
 * config (any explicit choice) always wins, so this never stomps a chosen lens.
 * Returns the adopted persona, or null when nothing was adopted.
 */
export async function adoptAccountPersonaIfUnset(): Promise<PersonaType | null> {
  if (typeof window === "undefined") return null;
  if (hasStoredConfig()) return null; // a local choice already exists → don't override
  try {
    const supabase = createClient();
    const { data } = await supabase.auth.getUser();
    const metaPersona = asPersona(data.user?.user_metadata?.persona);
    if (!metaPersona) return null;
    saveConfig({ ...getConfig(), persona: metaPersona });
    return metaPersona;
  } catch {
    return null;
  }
}
