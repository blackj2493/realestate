/**
 * RSS 2.0 rendering for the /data desk.
 *
 * WHY RSS AT ALL. Every other channel we have is push: we post, an algorithm decides,
 * and the reach dies with the post. A feed is pull — Feedly, newsletter curators, local
 * news aggregators and Google all consume it on their own schedule, and nobody can
 * throttle or ban it. It is the only distribution we own outright.
 *
 * COMPLIANCE. A feed carries ONLY the computed market aggregates that already render
 * publicly on /data/<tracker> and /embed/<tracker> — never a listing record, never a
 * price/address/brokerage row, never anything VOW-derived. That line is the whole reason
 * this is safe to syndicate: IDX/VOW §6.2(g),(h),(r),(s) bar re-publishing the FEED, and
 * an aggregate we computed is not the feed. See docs/strategy/beat-housesigma/R0-compliance.md
 * §2 ("Aggregate COUNTS and histograms over the index"). If you ever add a per-listing
 * item to a feed, you have moved it from the safe column to the forbidden one.
 *
 * ITEM CADENCE. The trackers refresh nightly, so each feed emits one dated reading per
 * refresh (GUID keyed to the data date) plus the permanent findings. A subscriber sees
 * one new item a day, not fifty — which is the difference between a feed people keep and
 * a feed people mute.
 */

/** Characters that must not appear raw in XML text or attribute content. */
export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export interface FeedItem {
  title: string;
  /** Absolute URL the item points at. */
  link: string;
  /** Plain text; escaped on render. Keep it to a couple of sentences. */
  description: string;
  /**
   * Stable identity. Two renders of the SAME reading must produce the same guid or
   * every subscriber re-reads every item on every poll. Synthetic guids (a page URL
   * plus a data date) are not permalinks, so they render with isPermaLink="false".
   */
  guid: string;
  isPermaLink?: boolean;
  pubDate: Date;
  category?: string;
}

/**
 * RFC-822, which is what RSS 2.0 requires. `toUTCString()` already emits
 * "Sun, 14 Sep 2026 00:00:00 GMT" — compliant, and no dependency.
 */
function rfc822(d: Date): string {
  return d.toUTCString();
}

/**
 * A data date ("2026-09-14" or a full ISO timestamp) → the Date to stamp items with.
 * Falsy input falls back to now, so a feed still renders when the precompute is missing
 * its `computed_at` rather than 500-ing on an outreach channel.
 */
export function feedDate(iso: string | null | undefined): Date {
  if (!iso) return new Date();
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

/** "2026-09-14" from any ISO-ish stamp — the GUID key for one nightly reading. */
export function dataDateKey(iso: string | null | undefined): string {
  return feedDate(iso).toISOString().slice(0, 10);
}

export function renderRss(opts: {
  title: string;
  description: string;
  /** Absolute URL of THIS feed, for <atom:link rel="self">. Required by validators. */
  selfUrl: string;
  /** Absolute URL of the page this feed describes. */
  link: string;
  items: FeedItem[];
  /** Newest data stamp; defaults to the newest item. */
  lastBuildDate?: Date | null;
}): string {
  const { title, description, selfUrl, link, items } = opts;
  const newest =
    opts.lastBuildDate ??
    items.reduce<Date | null>((acc, i) => (acc == null || i.pubDate > acc ? i.pubDate : acc), null) ??
    new Date();

  const body = items
    .map((i) => {
      const permalink = i.isPermaLink === true;
      return [
        "    <item>",
        `      <title>${escapeXml(i.title)}</title>`,
        `      <link>${escapeXml(i.link)}</link>`,
        `      <description>${escapeXml(i.description)}</description>`,
        `      <guid isPermaLink="${permalink}">${escapeXml(i.guid)}</guid>`,
        i.category ? `      <category>${escapeXml(i.category)}</category>` : null,
        `      <pubDate>${rfc822(i.pubDate)}</pubDate>`,
        "    </item>",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(title)}</title>
    <link>${escapeXml(link)}</link>
    <description>${escapeXml(description)}</description>
    <language>en-CA</language>
    <lastBuildDate>${rfc822(newest)}</lastBuildDate>
    <ttl>720</ttl>
    <atom:link href="${escapeXml(selfUrl)}" rel="self" type="application/rss+xml" />
${body}
  </channel>
</rss>
`;
}

/**
 * The response every feed route returns. `s-maxage` matches the nightly precompute —
 * there is no value in a reader polling harder than the data moves, and a long
 * stale-while-revalidate keeps an aggregator from ever seeing a cold miss.
 */
export function rssResponse(xml: string): Response {
  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
