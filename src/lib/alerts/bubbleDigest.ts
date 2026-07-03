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
  /** Watermarked TRREB thumbnail URL, or null → text-only card (no stock stand-in). */
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
