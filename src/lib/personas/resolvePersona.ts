/**
 * resolvePersona — the SINGLE source of truth for "which persona lens is active"
 * across every surface (terminal, dashboard, detail page, Compare).
 *
 * Precedence (first match wins):
 *   1. explicit URL ?lens=        — an intentional choice (e.g. carried on a click)
 *   2. a persisted / in-session value (terminal store, dashboard localStorage)
 *   3. the applicant's /apply objectives (personalization seed)
 *   4. the per-scope cold-start default
 *
 * This replaces the prior split-brain where the terminal store, the dashboard
 * config, and the detail/Compare views each hard-coded their own default
 * independently (flippers / smart / smart) with no shared precedence.
 */
import { PERSONA_CONFIG, type PersonaType } from "@/lib/personas/personaConfig";

export type PersonaScope = "terminal" | "dashboard" | "detail" | "compare";

/**
 * Per-scope cold-start default — used ONLY when there is no url / persisted /
 * profile signal. EVERY surface now opens on the `smart` Homebuyer lens: the
 * terminal used to cold-start on `flippers`, which gave brand-new / anonymous
 * visitors investor framing everywhere (deal-signal columns, "how you invest"
 * copy) before they had chosen anything. The persona is a single shared value
 * (the dashboard config store) so this default only bites a first-ever visit;
 * any explicit choice — a stored persona, an /apply objective, or a ?lens= deep
 * link — still wins via the precedence below. Change a default HERE and every
 * surface follows.
 */
export const SCOPE_DEFAULT_PERSONA: Record<PersonaScope, PersonaType> = {
  terminal: "smart",
  dashboard: "smart",
  detail: "smart",
  compare: "smart",
};

/** Validate an untrusted string (URL param, localStorage) as a PersonaType. */
export function asPersona(v: unknown): PersonaType | null {
  return typeof v === "string" && v in PERSONA_CONFIG ? (v as PersonaType) : null;
}

/**
 * The Smart-Homebuyer /apply objective. Persona #1 (CLAUDE.md §2) previously had
 * NO onboarding entry point — every objective mapped to an investor lens and the
 * Homebuyer lens was only ever reached as a silent fall-through. This gives it one.
 * Keep this string identical to the literal in apply/page.tsx OBJECTIVES.
 */
export const HOMEBUYER_OBJECTIVE =
  "Buy a home with hidden value (suite / basement potential)";

/**
 * /apply objective → persona. TOTAL over the current objective set: every known
 * objective resolves to an explicit lens (no silent fall-through). Notably,
 * "Source zoning & conversion upside" was previously UNMAPPED (it fell through to
 * the default) — it now maps to `cashflow` (the income-suite / conversion lens).
 */
const OBJECTIVE_TO_PERSONA: Record<string, PersonaType> = {
  "Land assembly / development": "builders",
  "Target distressed & off-market deals": "flippers",
  "Analyze rental yield / cap rates": "cashflow",
  "Source zoning & conversion upside": "cashflow",
  [HOMEBUYER_OBJECTIVE]: "smart",
};

/**
 * Fixed priority used when a profile lists MULTIPLE objectives, so the result is
 * deterministic regardless of the order the user happened to tick them. Preserves
 * the prior resolution order (builders > flippers > cashflow), then the formerly
 * unmapped conversion objective, then the homebuyer objective.
 */
const OBJECTIVE_PRIORITY: string[] = [
  "Land assembly / development",
  "Target distressed & off-market deals",
  "Analyze rental yield / cap rates",
  "Source zoning & conversion upside",
  HOMEBUYER_OBJECTIVE,
];

/** First objective (by fixed priority) that maps to a persona, else null. */
export function personaFromObjectives(
  objectives: string[] | null | undefined
): PersonaType | null {
  if (!objectives || objectives.length === 0) return null;
  const set = new Set(objectives);
  for (const o of OBJECTIVE_PRIORITY) {
    if (set.has(o)) return OBJECTIVE_TO_PERSONA[o];
  }
  return null;
}

export interface PersonaSources {
  /** explicit ?lens= URL param (highest priority — an intentional choice). */
  url?: string | null;
  /** a persisted / in-session value (terminal store, dashboard localStorage). */
  persisted?: string | null;
  /** the applicant's /apply objectives (personalization seed). */
  objectives?: string[] | null;
}

/** Resolve the active persona for a scope under the documented precedence. */
export function resolvePersona(
  scope: PersonaScope,
  sources: PersonaSources = {}
): PersonaType {
  return (
    asPersona(sources.url) ??
    asPersona(sources.persisted) ??
    personaFromObjectives(sources.objectives) ??
    SCOPE_DEFAULT_PERSONA[scope]
  );
}

/**
 * Two-arg convenience over resolvePersona for the surfaces that only have a URL
 * param and a stored value (the terminal + listing detail): explicit ?lens= wins,
 * else the stored persona, else the scope's cold-start default. The applicant's
 * /apply objectives are already baked into the stored persona, so they need not be
 * re-supplied here.
 */
export function resolveActiveLens(
  urlParam: string | null | undefined,
  stored: string | null | undefined,
  scope: PersonaScope = "terminal"
): PersonaType {
  return resolvePersona(scope, { url: urlParam, persisted: stored });
}
