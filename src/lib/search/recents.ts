/**
 * Recent searches — a useful empty state. Pure localStorage (no backend, no PII
 * leaving the device), SSR-safe. Watched areas (saved bubbles / commute zones)
 * are sourced separately from the store at render time; this only owns the
 * lightweight "things you searched" list.
 */

export type RecentKind = "place" | "address" | "nl" | "mls";

export interface RecentSearch {
  id: string;
  label: string;
  kind: RecentKind;
  ts: number;
}

const KEY = "pp_search_recents_v1";
const MAX = 8;

function read(): RecentSearch[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RecentSearch[]) : [];
  } catch {
    return [];
  }
}

function write(list: RecentSearch[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    /* quota / private mode — recents are best-effort */
  }
}

export function getRecents(): RecentSearch[] {
  return read().sort((a, b) => b.ts - a.ts);
}

/** Add (or bump) a recent search. De-dupes on case-insensitive label. */
export function pushRecent(entry: { label: string; kind: RecentKind }): void {
  const label = entry.label.trim();
  if (!label) return;
  const existing = read().filter((r) => r.label.toLowerCase() !== label.toLowerCase());
  const next: RecentSearch = {
    id: `${entry.kind}:${label.toLowerCase()}`,
    label,
    kind: entry.kind,
    // ts is supplied by the caller's clock at call time (avoids importing Date here
    // would be ideal, but localStorage recency genuinely needs wall-clock ordering).
    ts: Date.now(),
  };
  write([next, ...existing]);
}

export function clearRecents(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
