/**
 * Bubble new-listing digest shaping — pure (§4). Enforces the anti-irritation
 * model from the spec: ≤6 rows per bubble, noisy bubbles collapse to a count,
 * a listing matching several of a user's bubbles appears once (first wins).
 *
 * "First wins" is only fair if FIRST means something. compareBubbleSpecificity defines
 * that order — see its own note.
 */

import { isWholeCityRegion } from "@/lib/dashboard/area";

export interface NewListingAlert {
  listing_key: string;
  address: string;
  city: string | null;
  price: number | null;
  beds: number | null;
  baths: number | null;
  brokerage: string | null;
  /** Listing thumbnail (PropTx MediaURL) for the email row; null when the feed has no photo. */
  thumb?: string | null;
  /** EntryTimestamp (unix ms) — used only for newest-first ordering. */
  entryMs: number;
}

export interface BubbleMatches {
  bubbleId: string;
  bubbleName: string;
  /** True match count from Typesense `found` (may exceed matches.length). */
  total: number;
  matches: NewListingAlert[];
  /** alert_scope 'filtered': the active-filter summary ("3+ Beds · Detached") the
   *  email must show so the user can reason about what they're NOT seeing. */
  filterLabel?: string | null;
}

export interface BubbleSection {
  bubbleId: string;
  bubbleName: string;
  total: number;
  /** ≤ BUBBLE_EMAIL_ROW_CAP rows, newest first. NEVER empty — see buildBubbleSections. */
  listings: NewListingAlert[];
  /**
   * The area produced more than BUBBLE_COLLAPSE_THRESHOLD new listings tonight. The rows
   * still render; this only adds the line naming the full count and linking to all of it.
   */
  highVolume: boolean;
  /** Present when the bubble alerts on its saved filters (alert_scope 'filtered'). */
  filterLabel?: string | null;
}

export const BUBBLE_EMAIL_ROW_CAP = 6;
/**
 * Above this many matches a section is HIGH VOLUME: it still shows its rows, and gains a
 * line naming the full count.
 *
 * It used to mean "show no rows at all" — the section rendered as a bare number and a tip.
 * That is the worst output the digest can produce, and the busiest areas produced it every
 * single night: Toronto enters ~143 new listings a night, Mississauga ~33, Brampton ~31,
 * all far past this threshold. So a new user who tracked a city got "143 new listings
 * appeared in this area" and not one home, nightly, until they unsubscribed. Six real
 * homes plus the count is strictly more useful and no longer than the tip it replaced.
 */
export const BUBBLE_COLLAPSE_THRESHOLD = 20;

// ── Scan order: narrowest area first ────────────────────────────────────────
/** The only fields the ordering needs — the worker's row and a test row both satisfy it. */
export interface BubbleAreaOrder {
  id: string;
  name: string;
  area_type: string;
  source?: { city?: string } | null;
  created_at?: string | null;
}

/**
 * Rank an area by how specific it is. Lower claims a listing first.
 *
 * 0 — drawn / commute / school. Hand-placed by the user, and never a superset of a city.
 * 1 — a community or neighbourhood city row ("Vellore Village", a Toronto district).
 * 2 — a whole city, which CONTAINS every rank-1 area a user might also have saved.
 */
function specificityRank(b: BubbleAreaOrder): number {
  if (b.area_type !== "city") return 0;
  return isWholeCityRegion(b.source?.city ?? b.name) ? 2 : 1;
}

/**
 * Total, stable scan order for a user's alerting areas.
 *
 * `buildBubbleSections` hands a listing to the FIRST area that matched it and shrinks
 * every later area's count by what it lost — an area that loses all of its matches drops
 * out of the email entirely (`total <= 0`). Until now "first" was whatever order Postgres
 * returned, because the worker's query carried no ORDER BY, so a broad area could swallow
 * a narrow one nested inside it and the choice could differ from night to night.
 *
 * Observed on prod 2026-09-01: one account held both "Barrhaven" and
 * "7711 - Barrhaven - Half Moon Bay" with identical filters. Every Half Moon Bay listing
 * is also a Barrhaven listing, so whichever row the scan reached first took all of them
 * and the other section rendered nothing.
 *
 * Sorting by rank makes the winner the most precisely named area the user has. created_at
 * then id break ties, so the order is total — the same every night — rather than merely
 * narrower-usually-first.
 */
export function compareBubbleSpecificity(a: BubbleAreaOrder, b: BubbleAreaOrder): number {
  const byRank = specificityRank(a) - specificityRank(b);
  if (byRank !== 0) return byRank;
  const byAge = (a.created_at ?? "").localeCompare(b.created_at ?? "");
  return byAge !== 0 ? byAge : a.id.localeCompare(b.id);
}

// ── Lookback dedup (migration 083 market_bubbles.notified_keys) ──────────────
// The worker searches EntryTimestamp past (watermark − LOOKBACK) so listings the
// feed published late still surface; notified_keys stops the overlap re-alerting.

/** How far past the notify_since watermark the new-listing search reaches back. */
export const BUBBLE_LOOKBACK_MS = 72 * 60 * 60 * 1000;
/** How long an alerted key stays in notified_keys before pruning. */
export const NOTIFIED_KEY_RETENTION_MS = 10 * 24 * 60 * 60 * 1000;

export interface NotifiedKey {
  /** Listing key. */
  k: string;
  /** When it was recorded (epoch ms) — drives retention pruning. */
  t: number;
}

/** Defensive parse of the JSONB column (bad shapes → empty). */
export function parseNotifiedKeys(v: unknown): NotifiedKey[] {
  if (!Array.isArray(v)) return [];
  return v.filter(
    (e): e is NotifiedKey =>
      !!e &&
      typeof e === "object" &&
      typeof (e as NotifiedKey).k === "string" &&
      typeof (e as NotifiedKey).t === "number"
  );
}

/** Drop matches already alerted for this bubble. */
export function filterFreshMatches<T extends { listing_key: string }>(
  matches: T[],
  notified: NotifiedKey[]
): T[] {
  const seen = new Set(notified.map((n) => n.k));
  return matches.filter((m) => !seen.has(m.listing_key));
}

/** notified_keys for the next run: old entries within retention + tonight's matches. */
export function advanceNotifiedKeys(
  notified: NotifiedKey[],
  freshKeys: string[],
  nowMs: number
): NotifiedKey[] {
  const cutoff = nowMs - NOTIFIED_KEY_RETENTION_MS;
  const kept = notified.filter((n) => n.t >= cutoff);
  const have = new Set(kept.map((n) => n.k));
  for (const k of freshKeys) if (!have.has(k)) kept.push({ k, t: nowMs });
  return kept;
}

export function buildBubbleSections(perBubble: BubbleMatches[]): BubbleSection[] {
  const seen = new Set<string>();
  const sections: BubbleSection[] = [];

  for (const b of perBubble) {
    const deduped = b.matches.filter((m) => !seen.has(m.listing_key));
    for (const m of deduped) seen.add(m.listing_key);
    // De-dup shrinks the displayed total by however many rows this bubble lost.
    const total = b.total - (b.matches.length - deduped.length);
    if (total <= 0) continue;

    // Every section shows rows, however busy the area is. The row cap already bounds the
    // email; a high count only changes what the line under the rows says.
    const rows = [...deduped].sort((a, z) => z.entryMs - a.entryMs).slice(0, BUBBLE_EMAIL_ROW_CAP);
    if (rows.length === 0) continue;
    sections.push({
      bubbleId: b.bubbleId,
      bubbleName: b.bubbleName,
      total,
      listings: rows,
      highVolume: total > BUBBLE_COLLAPSE_THRESHOLD,
      filterLabel: b.filterLabel ?? null,
    });
  }

  return sections;
}
