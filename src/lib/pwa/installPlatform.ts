/**
 * Install-platform detection and the nudge policy, as pure functions (no `window`),
 * so every decision is unit-tested and the React layer stays thin.
 *
 * Platforms:
 *   installed   — running from the home screen (or installed earlier); never nag
 *   ios         — Safari/Chrome on iPhone or iPad: no install API, show the how-to sheet
 *   android     — Chrome fired `beforeinstallprompt`; we can open the native dialog
 *   desktop     — same event on desktop Chrome/Edge; the menu row works, the nudge stays off
 *   unsupported — nothing to offer (Firefox, or the event hasn't fired yet)
 */

export type InstallPlatform = "installed" | "ios" | "android" | "desktop" | "unsupported";

export interface DetectInput {
  userAgent: string;
  /** navigator.maxTouchPoints — iPadOS reports a Macintosh UA; touch is the tell. */
  maxTouchPoints: number;
  /** (display-mode: standalone) matched, or navigator.standalone on iOS. */
  standalone: boolean;
  /** A `beforeinstallprompt` event is being held. */
  hasNativePrompt: boolean;
}

export function isIos(userAgent: string, maxTouchPoints: number): boolean {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return true;
  return /Macintosh/i.test(userAgent) && maxTouchPoints > 1;
}

export function detectInstallPlatform(input: DetectInput): InstallPlatform {
  if (input.standalone) return "installed";
  if (isIos(input.userAgent, input.maxTouchPoints)) return "ios";
  if (input.hasNativePrompt) return /Android/i.test(input.userAgent) ? "android" : "desktop";
  return "unsupported";
}

// ── Nudge policy ────────────────────────────────────────────────────────────

/** Second visit at the earliest — a first-time visitor has nothing to come back to yet. */
export const NUDGE_MIN_VISITS = 2;
/** After "Not now" (or an auto-hide) the nudge stays away for a month. */
export const NUDGE_SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;

export interface NudgeInput {
  platform: InstallPlatform;
  isMobile: boolean;
  visits: number;
  dismissedAt: number | null;
  now: number;
}

/**
 * Whether the proactive install nudge may appear. Phones only: desktop Chrome has its
 * own install icon in the address bar, and a nudge there is noise. The caller layers
 * the surface and overlay checks on top (see InstallNudge.tsx).
 */
export function shouldShowInstallNudge(i: NudgeInput): boolean {
  if (i.platform !== "ios" && i.platform !== "android") return false;
  if (!i.isMobile) return false;
  if (i.visits < NUDGE_MIN_VISITS) return false;
  if (i.dismissedAt !== null && i.now - i.dismissedAt < NUDGE_SNOOZE_MS) return false;
  return true;
}

// ── Durable state (localStorage `pp_pwa_install`) ───────────────────────────

export const STORE_KEY = "pp_pwa_install";

export interface InstallState {
  /** Sessions seen on this device (one bump per tab session). */
  visits: number;
  /** Epoch ms of the last "Not now" / auto-hide; drives the snooze. */
  dismissedAt: number | null;
  /** Epoch ms we first saw the app installed (appinstalled, or a standalone launch). */
  installedAt: number | null;
}

export const EMPTY_INSTALL_STATE: InstallState = { visits: 0, dismissedAt: null, installedAt: null };

function finiteOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Tolerant parse — anything malformed collapses to the empty state, never throws. */
export function parseInstallState(raw: string | null): InstallState {
  if (!raw) return { ...EMPTY_INSTALL_STATE };
  try {
    const p = JSON.parse(raw) as unknown;
    if (!p || typeof p !== "object") return { ...EMPTY_INSTALL_STATE };
    const r = p as Partial<Record<keyof InstallState, unknown>>;
    const visits = finiteOrNull(r.visits);
    return {
      visits: visits !== null && visits >= 0 ? Math.floor(visits) : 0,
      dismissedAt: finiteOrNull(r.dismissedAt),
      installedAt: finiteOrNull(r.installedAt),
    };
  } catch {
    return { ...EMPTY_INSTALL_STATE };
  }
}
