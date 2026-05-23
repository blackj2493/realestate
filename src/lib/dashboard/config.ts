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

const ACCESS_KEY = 'pp_access';
const PROFILE_KEY = 'pp_profile';
const CONFIG_KEY = 'pp_dashboard_config';
/** per-region "max EntryTimestamp seen" — powers unit-agnostic since-last-visit. */
const SEEN_PREFIX = 'pp_seen_max:';

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

export interface DashboardConfig {
  /** Typesense `City` values (municipalities). */
  regions: string[];
  /** Enabled boards, in display order. */
  boards: BoardId[];
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

// ── Access gate ──────────────────────────────────────────────────────────────
export function hasAccess(): boolean {
  if (!hasWindow()) return false;
  return window.localStorage.getItem(ACCESS_KEY) === 'granted';
}
export function grantAccess(): void {
  if (hasWindow()) window.localStorage.setItem(ACCESS_KEY, 'granted');
}
export function clearAccess(): void {
  if (hasWindow()) window.localStorage.removeItem(ACCESS_KEY);
}

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
export function seedConfigFromProfile(p: ApplyProfile): DashboardConfig {
  return {
    regions: citiesFromRegions(p.regions ?? []),
    boards: orderBoardsByObjectives(p.objectives ?? []),
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
        };
      }
    } catch {
      /* fall through to seed */
    }
    const profile = getProfile();
    if (profile) return seedConfigFromProfile(profile);
  }
  return { regions: [], boards: [...DEFAULT_BOARD_ORDER] };
}

// ── Since-last-visit (per region, unit-agnostic) ─────────────────────────────
/** The highest EntryTimestamp this client has already seen for a region. */
export function getSeenMax(region: string): number | null {
  if (!hasWindow()) return null;
  const raw = window.localStorage.getItem(SEEN_PREFIX + region);
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : null;
}
export function setSeenMax(region: string, value: number): void {
  if (hasWindow() && Number.isFinite(value)) {
    window.localStorage.setItem(SEEN_PREFIX + region, String(value));
  }
}
