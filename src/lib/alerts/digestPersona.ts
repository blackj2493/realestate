/**
 * Which persona orders a reader's angle picks (pickAngles) — pure (§4).
 *
 * Same precedence the site uses (resolvePersona.ts), minus the URL step email cannot have:
 *   1. the persona saved in the reader's dashboard config — the lens they last chose;
 *   2. the objectives they gave on /apply;
 *   3. homebuyer, the site-wide default and by far the largest group.
 */
import { asPersona, personaFromObjectives } from "@/lib/personas/resolvePersona";
import type { PersonaType } from "@/lib/personas/personaConfig";

export function digestPersona(rawConfig: unknown, objectives: string[] | null | undefined): PersonaType {
  const saved =
    rawConfig && typeof rawConfig === "object" ? asPersona((rawConfig as { persona?: unknown }).persona) : null;
  return saved ?? personaFromObjectives(objectives) ?? "smart";
}
