/**
 * Home-dashboard client state (localStorage).
 *
 * The app is anonymous (auth is vestigial), so the access gate, the applicant
 * profile (personalization seed), and the editable dashboard config all live in
 * localStorage. All getters are SSR-safe (return defaults when `window` is absent).
 */

import {
  BOARDS,
  type BoardId,
  DEFAULT_BOARD_ORDER,
  orderBoardsByObjectives,
} from './boards';
import { PERSONA_CONFIG, type PersonaType } from '@/lib/personas/personaConfig';
import { personaFromObjectives, SCOPE_DEFAULT_PERSONA } from '@/lib/personas/resolvePersona';

/**
 * Dashboard persona — reuses the Command Center's PersonaType vocabulary, but
 * persisted here (localStorage) and scoped to the dashboard. The Command Center's
 * own `commandCenterStore.activePersona` is a SEPARATE in-memory value (a transient
 * analysis session); the two are intentionally not shared.
 */
export const DEFAULT_PERSONA: PersonaType = SCOPE_DEFAULT_PERSONA.dashboard;

const isPersona = (v: unknown): v is PersonaType =>
  typeof v === 'string' && v in PERSONA_CONFIG;

const PROFILE_KEY = 'pp_profile';
const CONFIG_KEY = 'pp_dashboard_config';

export interface ApplyProfile {
  applicantType?: string;
  fullName?: string;
  email?: string;
  entityName?: string;
  objectives: string[];
  regions: string[];
  capital?: string;
  assets: string[];
  cadence?: string;
}

/**
 * The global "lens" for the Market Activity panel — one window + filter set that
 * applies to every region's New (active/IDX) and Sold (VOW) counts and lists.
 */
/** Sale vs lease scope. Applied via the indexed `TransactionType` facet on the
 *  Typesense collection (`TransactionType:=`For Sale``) and the for-sale list_price
 *  floor on the server-side sold/active aggregates. (Superseded the old ListPrice
 *  threshold proxy once TransactionType was added to the live schema, 2026-05-28.) */
export type TransactionScope = 'sale' | 'lease';

/**
 * Basement finish filter. `any` = no constraint; `finished` and `unfinished`
 * map to the active (BasementType) and sold (BasementTier band) collections —
 * see queries.ts / soldFilter.ts. Replaced the old boolean `basementFinished`.
 */
export type BasementFilter = 'any' | 'finished' | 'unfinished';

export interface MarketActivityLens {
  /** trailing-window in days for both New and Sold counts. */
  windowDays: number;
  /** sale vs lease — scopes every active-inventory surface. */
  transactionType: TransactionScope;
  /** selected property-type option keys (see propertyTypes.ts); [] = all types. */
  propertyTypes: string[];
  /** bedrooms count for the beds filter (0 = any); min vs exact set by bedsExact. */
  minBeds: number;
  /** match beds exactly (`=`) instead of as a minimum (`>=`). */
  bedsExact: boolean;
  /** bathrooms count (0 = any); min vs exact set by bathsExact. */
  minBaths: number;
  /** match baths exactly (`=`) instead of as a minimum (`>=`). */
  bathsExact: boolean;
  /** parking/garage count (0 = any); min vs exact set by garageExact. */
  minGarage: number;
  /** match parking exactly (`=`) instead of as a minimum (`>=`). */
  garageExact: boolean;
  /** basement finish constraint: any | finished | unfinished. */
  basement: BasementFilter;
  /** minimum lot frontage in feet (0 = any). */
  minFrontage: number;
}

/** Allowed window options (days). Sold history capped at 180 for V1 — see plan. */
export const ACTIVITY_WINDOWS = [1, 3, 7, 30, 90, 180] as const;

export const DEFAULT_ACTIVITY_LENS: MarketActivityLens = {
  windowDays: 1,
  transactionType: 'sale',
  propertyTypes: [],
  minBeds: 0,
  bedsExact: false,
  minBaths: 0,
  bathsExact: false,
  minGarage: 0,
  garageExact: false,
  basement: 'any',
  minFrontage: 0,
};

/**
 * Does this lens actually narrow anything?
 *
 * WHY THIS EXISTS. `alert_scope = 'filtered'` promises the nightly email carries only the
 * homes matching your dashboard filters. The promise is EMPTY when no filter is set:
 * buildLensClauses returns nothing for a default lens, the worker falls back to the bare
 * price floor, and 'filtered' delivers exactly what 'all' delivers.
 *
 * That made the §176 whole-city guard a no-op for the very people it was written for. A
 * brand-new user has no filters, so their first city was a firehose whatever the column
 * said — Toronto enters ~143 new listings a night, and the digest collapsed every one of
 * them into a bare count. Scope alone can therefore never answer "is this area filtered?".
 * Ask this instead, and let the answer drive both the default and what the email says.
 *
 * `windowDays` is deliberately NOT a filter: it sizes the dashboard's trailing window, and
 * the worker's watermark governs "new" in email. `transactionType: 'lease'` IS one — it
 * swaps the entire result set, and lensLabel already prints it as "For Rent".
 */
export function hasActiveLensFilters(lens: MarketActivityLens): boolean {
  return (
    lens.propertyTypes.length > 0 ||
    lens.minBeds > 0 ||
    lens.minBaths > 0 ||
    lens.minGarage > 0 ||
    lens.basement !== 'any' ||
    lens.minFrontage > 0 ||
    lens.transactionType === 'lease'
  );
}

export interface DashboardConfig {
  /** Typesense `City` values (municipalities). */
  regions: string[];
  /** Enabled boards, in display order. */
  boards: BoardId[];
  /** Global Market Activity lens (window + filters). */
  marketActivity: MarketActivityLens;
  /** Active dashboard persona — reshapes which metrics/boards lead. */
  persona: PersonaType;
  /**
   * Epoch ms of the user's PREVIOUS visit — the cutoff the action feed compares
   * against ("what changed since you last looked"). Null until the first stamp.
   */
  lastVisitAt: number | null;
  /**
   * True once the user dismissed the "apply your filters to your area emails?" prompt
   * (AlertFilterPrompt). Cleared whenever the lens changes, so a NEW set of filters asks
   * once more. Optional — absent from every config written before this field existed.
   */
  alertPromptDismissed?: boolean;
}

/**
 * /apply uses coarse GTA regions; Typesense filters on municipality-level `City`.
 * This maps each region to sensible default cities the user can then edit.
 */
export const REGION_TO_CITIES: Record<string, string[]> = {
  Toronto: ['Toronto'],
  Peel: ['Mississauga', 'Brampton'],
  York: ['Markham', 'Vaughan', 'Richmond Hill'],
  Durham: ['Oshawa', 'Whitby', 'Ajax', 'Pickering'],
  Halton: ['Oakville', 'Burlington', 'Milton'],
  Hamilton: ['Hamilton'],
  Ottawa: ['Ottawa'],
  Other: [],
};

const hasWindow = () => typeof window !== 'undefined';

// NOTE: dashboard access is no longer a localStorage flag — it is enforced by a
// real Supabase session in the server component at app/(app)/dashboard/page.tsx
// (VOW compliance). The old hasAccess/grantAccess/clearAccess rope was removed.

// ── Applicant profile ────────────────────────────────────────────────────────
export function saveProfile(p: ApplyProfile): void {
  if (hasWindow()) window.localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
}
export function getProfile(): ApplyProfile | null {
  if (!hasWindow()) return null;
  try {
    const raw = window.localStorage.getItem(PROFILE_KEY);
    return raw ? (JSON.parse(raw) as ApplyProfile) : null;
  } catch {
    return null;
  }
}

/**
 * Wipe the locally-stored workspace — the applicant profile and the dashboard config.
 *
 * These live in localStorage, NOT in Supabase, so they outlive the account that created
 * them: deleting a user server-side leaves them untouched, and so does signing out. On a
 * shared browser that means the next person to create an account inherits the previous
 * one's saved cities, persona, boards and market lens — and, because DashboardClient
 * greets the user with getProfile()?.fullName, is greeted by the previous person's NAME.
 *
 * Call this when a brand-new account is being set up (see AcceptTermsForm's first-run
 * path) so a new account always starts from a clean workspace on this device.
 */
export function resetLocalWorkspace(): void {
  if (!hasWindow()) return;
  window.localStorage.removeItem(PROFILE_KEY);
  window.localStorage.removeItem(CONFIG_KEY);
}

/**
 * Whether the stored workspace must belong to a DIFFERENT account than one that is only
 * now accepting terms for the first time.
 *
 * The tell is saved regions. /apply — the only pre-account writer — always stores
 * `regions: []` (profiling was dropped from signup), and nothing else writes regions
 * until a user picks them from inside the app. So on a first-ever acceptance any
 * non-empty regions list can only have come from a previous account on this browser.
 */
export function hasForeignWorkspace(): boolean {
  return getConfig().regions.length > 0;
}

// ── Region → city mapping ────────────────────────────────────────────────────
export function citiesFromRegions(regions: string[]): string[] {
  const out: string[] = [];
  for (const r of regions) {
    for (const c of REGION_TO_CITIES[r] ?? []) {
      if (!out.includes(c)) out.push(c);
    }
  }
  return out;
}

// ── Dashboard config ─────────────────────────────────────────────────────────

/**
 * Best-effort seed of the dashboard persona from the /apply objectives. Falls
 * back to "smart" (the default) when nothing matches — the user can always
 * switch personas at runtime.
 */
export function personaFromProfile(p: ApplyProfile | null): PersonaType {
  // Single source of truth for the objective→persona map (resolvePersona.ts),
  // total over the objective set; falls back to the dashboard default on no match.
  return personaFromObjectives(p?.objectives) ?? DEFAULT_PERSONA;
}

export function seedConfigFromProfile(p: ApplyProfile): DashboardConfig {
  return {
    regions: citiesFromRegions(p.regions ?? []),
    boards: orderBoardsByObjectives(p.objectives ?? []),
    marketActivity: { ...DEFAULT_ACTIVITY_LENS },
    persona: personaFromProfile(p),
    lastVisitAt: null,
  };
}

/** Merge a stored (possibly partial/legacy) lens onto the defaults. */
function mergeLens(raw: unknown): MarketActivityLens {
  // `basementFinished` is the pre-tri-state legacy key; read it off the raw object
  // so an old localStorage value upgrades to `basement: 'finished'` cleanly.
  const l = (raw ?? {}) as Partial<MarketActivityLens> & { basementFinished?: unknown };
  const basement: BasementFilter =
    l.basement === 'finished' || l.basement === 'unfinished' || l.basement === 'any'
      ? l.basement
      : l.basementFinished === true
        ? 'finished'
        : 'any';
  return {
    windowDays:
      typeof l.windowDays === 'number' && ACTIVITY_WINDOWS.includes(l.windowDays as 1)
        ? l.windowDays
        : DEFAULT_ACTIVITY_LENS.windowDays,
    transactionType: l.transactionType === 'lease' ? 'lease' : 'sale',
    propertyTypes: Array.isArray(l.propertyTypes) ? l.propertyTypes : [],
    minBeds: typeof l.minBeds === 'number' ? l.minBeds : 0,
    bedsExact: l.bedsExact === true,
    minBaths: typeof l.minBaths === 'number' ? l.minBaths : 0,
    bathsExact: l.bathsExact === true,
    minGarage: typeof l.minGarage === 'number' ? l.minGarage : 0,
    garageExact: l.garageExact === true,
    basement,
    minFrontage: typeof l.minFrontage === 'number' ? l.minFrontage : 0,
  };
}

/** True when THIS device already has a saved dashboard config (i.e. an explicit
 *  choice exists). Lets the account-metadata adopt path stay local-first. SSR-safe. */
export function hasStoredConfig(): boolean {
  if (!hasWindow()) return false;
  try {
    return window.localStorage.getItem(CONFIG_KEY) !== null;
  } catch {
    return false;
  }
}

export function saveConfig(c: DashboardConfig): void {
  if (!hasWindow()) return;
  // Mirror a CHANGED persona to the signed-in user's account metadata so the lens
  // follows the account across devices + surfaces (the terminal, dashboard and
  // listing pages all read this one store). localStorage stays the source of truth;
  // this is a best-effort fire-and-forget. Gated on an actual persona change so
  // region/board edits and per-visit lastVisitAt stamps never trigger an auth write.
  // The Supabase browser client is dynamically imported so it never lands in a
  // server bundle that happens to import this (SSR-safe) config module.
  let personaChanged = false;
  try {
    personaChanged = getConfig().persona !== c.persona;
  } catch {
    personaChanged = true;
  }
  window.localStorage.setItem(CONFIG_KEY, JSON.stringify(c));
  if (personaChanged) {
    void import("@/lib/personas/personaAccount")
      .then((m) => m.mirrorPersonaToAccount(c.persona))
      .catch(() => {});
  }
}

/**
 * Shape-guard an untyped config blob (localStorage OR the dashboard_prefs jsonb —
 * migration 096) onto the current DashboardConfig shape. Single normalizer so
 * server and local storage can never drift in how they degrade.
 */
/**
 * Drop board ids this build no longer defines (RETIRED_BOARD_IDS, and anything else a
 * hand-edited or future config carries). A stored config keeps whatever it was saved
 * with, and it round-trips through `dashboard_prefs`, so a retired id would otherwise
 * outlive the board by years. The render path already ignores unknown ids —
 * `.map(id => BOARDS[id]).filter(Boolean)` in DashboardClient — so this is about not
 * PERSISTING a dead entry, not about avoiding a crash.
 *
 * Filtering everything away means the stored set is entirely retired: fall back to the
 * defaults rather than leaving the user with a dashboard of no boards at all.
 */
function keepKnownBoards(stored: BoardId[]): BoardId[] {
  const known = stored.filter((id) => id in BOARDS);
  return known.length ? known : [...DEFAULT_BOARD_ORDER];
}

export function normalizeConfig(raw: unknown): DashboardConfig {
  const parsed = (raw ?? {}) as Partial<DashboardConfig>;
  return {
    regions: Array.isArray(parsed.regions) ? parsed.regions : [],
    boards:
      Array.isArray(parsed.boards) && parsed.boards.length
        ? keepKnownBoards(parsed.boards)
        : [...DEFAULT_BOARD_ORDER],
    marketActivity: mergeLens(parsed.marketActivity),
    persona: isPersona(parsed.persona) ? parsed.persona : DEFAULT_PERSONA,
    lastVisitAt: typeof parsed.lastVisitAt === 'number' ? parsed.lastVisitAt : null,
    alertPromptDismissed: parsed.alertPromptDismissed === true,
  };
}

/** Stored config, else seeded from the profile, else a sensible empty default. */
export function getConfig(): DashboardConfig {
  if (hasWindow()) {
    try {
      const raw = window.localStorage.getItem(CONFIG_KEY);
      if (raw) return normalizeConfig(JSON.parse(raw));
    } catch {
      /* fall through to seed */
    }
    const profile = getProfile();
    if (profile) return seedConfigFromProfile(profile);
  }
  return {
    regions: [],
    boards: [...DEFAULT_BOARD_ORDER],
    marketActivity: { ...DEFAULT_ACTIVITY_LENS },
    persona: DEFAULT_PERSONA,
    lastVisitAt: null,
  };
}

// ── Action-feed "last visit" cursor ──────────────────────────────────────────

/** Epoch ms of the previous visit (the action-feed cutoff), or null if first-ever. */
export function getLastVisit(): number | null {
  return getConfig().lastVisitAt;
}

/**
 * Stamp the current visit as `lastVisitAt = now`, returning the PREVIOUS value so
 * the caller can use it as the feed cutoff. Call once per dashboard mount, after
 * capturing the returned cutoff for the render.
 */
export function stampVisit(): number | null {
  const cfg = getConfig();
  const previous = cfg.lastVisitAt;
  if (hasWindow()) saveConfig({ ...cfg, lastVisitAt: Date.now() });
  return previous;
}
