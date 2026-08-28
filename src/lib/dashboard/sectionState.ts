/**
 * Which dashboard drill-down sections the user left open, persisted per device.
 *
 * WHY THIS EXISTS: every area section on the dashboard starts collapsed, because one
 * expanded section fires ~9 requests (new + sold, the stat tiles, and one per playlist
 * board) and a five-area dashboard would spend 45 of them before the user reads anything.
 * The collapse is right. Making the user redo it on every visit is not — a section they
 * opened yesterday is the clearest statement they have made about what they came for.
 *
 * Stored per device, NOT in `dashboard_prefs`: an open panel is a viewing position, like a
 * scroll offset, not an account preference. Syncing it would let a phone's cramped
 * single-open habit dictate what a desktop opens, and would make an idle read look like a
 * workspace edit to configSync.
 *
 * Keys are namespaced by section kind (`bubble:<uuid>`, `city:<region>`) so a bubble and a
 * city that share a name cannot collide.
 */

const KEY = 'pp_dashboard_sections';

/**
 * Deleted bubbles and removed cities leave their keys behind — nothing here can know a
 * section is gone for good. The cap bounds that drift: it is far above any real dashboard
 * (regions are capped well below this), so the only entries it ever evicts are stale.
 */
const MAX_KEYS = 60;

/** A key must be a short, non-empty string — anything else is a caller bug, not state. */
function validKey(key: unknown): key is string {
  return typeof key === 'string' && key.length > 0 && key.length <= 200;
}

/** The set of section keys stored as open. Never throws: a bad read means "all collapsed". */
export function readExpandedSections(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter(validKey));
  } catch {
    return new Set();
  }
}

/** True when this section was left open. Always false during SSR — see the note in RegionDrilldown. */
export function isSectionExpanded(key: string | undefined): boolean {
  if (!validKey(key)) return false;
  return readExpandedSections().has(key);
}

/**
 * True when this device has never recorded a section choice at all — the signal that
 * lets exactly ONE section open itself on a first visit (RegionDrilldown's
 * `autoOpenFirstRun`).
 *
 * WHY THIS EXISTS: every section starts collapsed, so a user who has never opened one
 * has never seen the open state, and reads the closed row as a heading rather than a
 * control. One auto-opened section costs one area's requests — not the five the
 * collapse was introduced to avoid — and it is the only change that TEACHES the
 * pattern rather than decorating it.
 *
 * The test is the absence of the key, NOT an empty set: a user who opened a section and
 * closed it again leaves `[]` behind, and that is a choice we must not overrule.
 */
export function noSectionChoiceMade(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(KEY) === null;
  } catch {
    // A private window can't remember anything, so it would auto-open on every visit.
    // Treat "cannot read" as "choice made" and leave every section collapsed.
    return false;
  }
}

/**
 * Record a toggle. Best-effort by design: a private window or a full quota must never
 * surface as an error on a panel the user just opened — the section still expands, it
 * simply will not be open again tomorrow.
 */
export function setSectionExpanded(key: string | undefined, expanded: boolean): void {
  if (typeof window === 'undefined') return;
  if (!validKey(key)) return;
  try {
    const open = readExpandedSections();
    // Delete first even when adding: Set.add keeps an existing key at its ORIGINAL
    // position, which would make the slice below evict a section the user just opened.
    open.delete(key);
    if (expanded) open.add(key);
    // Newest last, so the slice keeps what the user touched most recently.
    const list = [...open].slice(-MAX_KEYS);
    window.localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* private mode / quota — this visit still behaves, the next one just forgets */
  }
}
