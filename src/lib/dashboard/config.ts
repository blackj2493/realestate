/**
 * Home-dashboard client state (localStorage).
 *
 * The app is anonymous (auth is vestigial), so the access gate, the applicant
 * profile (personalization seed), and the editable dashboard config all live in
 * localStorage. All getters are SSR-safe (return defaults when `window` is absent).
 */

import {
  type BoardId,
  DEFAULT_BOARD_ORDER,
  orderBoardsByObjectives,
} from './boards';
import { PERSONA_CONFIG, type PersonaType } from '@/lib/personas/personaConfig';

/**
 * Dashboard persona — reuses the Command Center's PersonaType vocabulary, but
 * persisted here (localStorage) and scoped to the dashboard. The Command Center's
 * own `commandCenterStore.activePersona` is a SEPARATE in-memory value (a transient
 * analysis session); the two are intentionally not shared.
 */
export const DEFAULT_PERSONA: PersonaType = 'smart';

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

export interface MarketActivityLens {
  /** trailing-window in days for both New and Sold counts. */
  windowDays: number;
  /** sale vs lease — scopes every active-inventory surface. */
  transactionType: TransactionScope;
  /** selected property-type option keys (see propertyTypes.ts); [] = all types. */
  propertyTypes: string[];
  /** minimum bedrooms (0 = any). */
  minBeds: number;
  /** minimum bathrooms (0 = any). */
  minBaths: number;
  /** minimum parking/garage spaces (0 = any). */
  minGarage: number;
  /** require a finished basement. */
  basementFinished: boolean;
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
  minBaths: 0,
  minGarage: 0,
  basementFinished: false,
  minFrontage: 0,
};

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
  const objectives = p?.objectives ?? [];
  if (objectives.includes('Land assembly / development')) return 'builders';
  if (objectives.includes('Target distressed & off-market deals')) return 'flippers';
  if (objectives.includes('Analyze rental yield / cap rates')) return 'cashflow';
  return DEFAULT_PERSONA;
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
  const l = (raw ?? {}) as Partial<MarketActivityLens>;
  return {
    windowDays:
      typeof l.windowDays === 'number' && ACTIVITY_WINDOWS.includes(l.windowDays as 1)
        ? l.windowDays
        : DEFAULT_ACTIVITY_LENS.windowDays,
    transactionType: l.transactionType === 'lease' ? 'lease' : 'sale',
    propertyTypes: Array.isArray(l.propertyTypes) ? l.propertyTypes : [],
    minBeds: typeof l.minBeds === 'number' ? l.minBeds : 0,
    minBaths: typeof l.minBaths === 'number' ? l.minBaths : 0,
    minGarage: typeof l.minGarage === 'number' ? l.minGarage : 0,
    basementFinished: l.basementFinished === true,
    minFrontage: typeof l.minFrontage === 'number' ? l.minFrontage : 0,
  };
}

export function saveConfig(c: DashboardConfig): void {
  if (hasWindow()) window.localStorage.setItem(CONFIG_KEY, JSON.stringify(c));
}

/** Stored config, else seeded from the profile, else a sensible empty default. */
export function getConfig(): DashboardConfig {
  if (hasWindow()) {
    try {
      const raw = window.localStorage.getItem(CONFIG_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<DashboardConfig>;
        return {
          regions: Array.isArray(parsed.regions) ? parsed.regions : [],
          boards:
            Array.isArray(parsed.boards) && parsed.boards.length
              ? parsed.boards
              : [...DEFAULT_BOARD_ORDER],
          marketActivity: mergeLens(parsed.marketActivity),
          persona: isPersona(parsed.persona) ? parsed.persona : DEFAULT_PERSONA,
          lastVisitAt:
            typeof parsed.lastVisitAt === 'number' ? parsed.lastVisitAt : null,
        };
      }
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
