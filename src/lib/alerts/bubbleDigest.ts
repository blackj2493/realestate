/**
 * Bubble new-listing digest shaping — pure (§4). Enforces the anti-irritation
 * model from the spec: ≤6 rows per bubble, noisy bubbles collapse to a count,
 * a listing matching several of a user's bubbles appears once (first wins).
 */

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
}

export interface BubbleSection {
  bubbleId: string;
  bubbleName: string;
  total: number;
  /** ≤ BUBBLE_EMAIL_ROW_CAP rows, newest first. Empty when collapsed. */
  listings: NewListingAlert[];
  /** Bubble too noisy for rows — render a one-line count instead. */
  collapsed: boolean;
}

export const BUBBLE_EMAIL_ROW_CAP = 6;
export const BUBBLE_COLLAPSE_THRESHOLD = 20;

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

    if (total > BUBBLE_COLLAPSE_THRESHOLD) {
      sections.push({ bubbleId: b.bubbleId, bubbleName: b.bubbleName, total, listings: [], collapsed: true });
      continue;
    }

    const rows = [...deduped].sort((a, z) => z.entryMs - a.entryMs).slice(0, BUBBLE_EMAIL_ROW_CAP);
    if (rows.length === 0) continue;
    sections.push({ bubbleId: b.bubbleId, bubbleName: b.bubbleName, total, listings: rows, collapsed: false });
  }

  return sections;
}
