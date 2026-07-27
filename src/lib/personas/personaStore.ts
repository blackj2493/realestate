/**
 * Bridge between the Command Center terminal's in-memory lens and the shared persona
 * store (the dashboard config in localStorage, mirrored to the account).
 *
 * The terminal used to keep its own lens that cold-started on Flippers, out of sync
 * with the dashboard's Homebuyer default — the two never met. These helpers let the
 * terminal READ and WRITE the one shared value so the surfaces can't diverge again.
 */
import { getConfig, saveConfig } from "@/lib/dashboard/config";
import { pushConfig } from "@/lib/dashboard/configSync";
import { resolvePersona } from "@/lib/personas/resolvePersona";
import type { PersonaType } from "@/lib/personas/personaConfig";
import { adoptAccountPersonaIfUnset } from "@/lib/personas/personaAccount";

/**
 * Write a persona change through to the shared config: localStorage (source of truth),
 * the server sync (dashboard_prefs, migration 096) and — via saveConfig — the account
 * metadata mirror. A no-op when the value is unchanged, so re-applying the stored lens
 * on hydrate costs nothing. SSR / signed-out safe.
 */
export function persistPersona(persona: PersonaType): void {
  if (typeof window === "undefined") return;
  const cfg = getConfig();
  if (cfg.persona === persona) return;
  const next = { ...cfg, persona };
  saveConfig(next);
  pushConfig(next);
}

/**
 * Resolve the terminal's opening lens under the shared precedence — explicit ?lens=
 * URL param > stored persona > Homebuyer default — after first adopting an account
 * persona when this device has no local config yet. `apply` is the store's
 * setActivePersona, which write-throughs any resulting change back to the shared
 * config (so a ?lens= deep link both opens the lens and switches the session).
 */
export async function hydrateTerminalPersona(
  urlLens: string | null | undefined,
  apply: (p: PersonaType) => void
): Promise<void> {
  if (typeof window === "undefined") return;
  await adoptAccountPersonaIfUnset();
  apply(resolvePersona("terminal", { url: urlLens, persisted: getConfig().persona }));
}
