/**
 * Client-side persona-lens persistence for the listing detail page.
 *
 * A chip click in TheReadCard / DealScoreCard writes a long-lived cookie so the
 * SERVER can seed the next page view with the user's lens (page.tsx feeds it into
 * resolvePersona's `persisted` slot — `?lens=` still wins per the documented
 * precedence), and broadcasts a CustomEvent so every other persona picker on the
 * current page follows along without a refetch.
 */
import { asPersona } from "@/lib/personas/resolvePersona";
import type { PersonaType } from "@/lib/personas/personaConfig";

export const LENS_COOKIE = "pp_lens";
export const LENS_EVENT = "pp:lens-changed";

/** Persist the chosen lens (1-year cookie, best-effort) and notify other pickers. */
export function persistLens(persona: PersonaType): void {
  try {
    document.cookie = `${LENS_COOKIE}=${persona}; path=/; max-age=31536000; SameSite=Lax`;
  } catch {
    // Privacy mode / no document — persistence is best-effort, the click still works.
  }
  window.dispatchEvent(new CustomEvent(LENS_EVENT, { detail: { persona } }));
}

/** Follow lens changes made by other pickers on the page. Returns the unsubscribe. */
export function onLensChanged(cb: (persona: PersonaType) => void): () => void {
  const handler = (e: Event) => {
    const p = asPersona((e as CustomEvent).detail?.persona);
    if (p) cb(p);
  };
  window.addEventListener(LENS_EVENT, handler);
  return () => window.removeEventListener(LENS_EVENT, handler);
}
