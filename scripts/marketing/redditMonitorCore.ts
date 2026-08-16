/**
 * Pure logic for the Reddit-opportunity monitor: scoring, geo detection,
 * template filling, and Atom-feed parsing. No network, no env, no side
 * effects — everything here is unit-testable (redditMonitorCore.test.ts).
 * Transports/DB/email live in redditMonitor.ts; editorial config in
 * redditMonitorConfig.ts.
 */

import {
  CATEGORIES,
  EXCLUDED_AUTHORS,
  EXCLUDED_TITLES,
  ONTARIO_PLACES,
  SCORE_THRESHOLD,
  TEMPLATES,
  type SubredditConfig,
} from './redditMonitorConfig';

/** A post or comment, normalized from either transport (OAuth JSON or RSS). */
export interface RedditItem {
  /** Reddit fullname (t3_xxx post / t1_xxx comment) — the dedupe key. */
  id: string;
  kind: 'post' | 'comment';
  subreddit: string;
  author: string;
  /** Post title; for comments, the parent post's title when known. */
  title: string;
  /** Selftext / comment body, plain text. */
  body: string;
  permalink: string;
  createdUtc: Date;
}

export interface ScoredItem extends RedditItem {
  category: string;
  categoryLabel: string;
  score: number;
  triggers: string[];
  city: string | null;
  draftPersonal: string;
  draftCompany: string;
}

const PLACE_PATTERNS = ONTARIO_PLACES.map((p) => ({
  name: p,
  re: new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'),
}));

/** First Ontario place named in the text (proper-cased), or null. */
export function detectCity(text: string): string | null {
  for (const { name, re } of PLACE_PATTERNS) {
    if (re.test(text)) return name;
  }
  return null;
}

export function isExcludedAuthor(author: string): boolean {
  return EXCLUDED_AUTHORS.some((re) => re.test(author.trim()));
}

export function isExcludedTitle(title: string): boolean {
  return EXCLUDED_TITLES.some((re) => re.test(title));
}

/**
 * Score an item against the trigger taxonomy.
 *
 * Strong pattern = 3 pts, weak = 1, a question mark in the title = 1 (questions
 * are far better reply targets than statements). The item's category is the one
 * contributing the most strong hits. Returns null when the item doesn't clear
 * SCORE_THRESHOLD — except brand mentions, which always alert.
 *
 * Geo gate: in Canada-wide subs (geoImplied=false) an item must name an Ontario
 * place or mention a competitor/our brand; we can't help a Calgary thread and
 * alerting on one trains the operator to ignore the digest.
 */
export function scoreItem(item: RedditItem, sub: Pick<SubredditConfig, 'geoImplied'>): ScoredItem | null {
  const text = `${item.title}\n${item.body}`;
  const city = detectCity(text);

  let best: { id: string; label: string; strongHits: string[] } | null = null;
  let totalStrong = 0;
  let totalWeak = 0;
  const triggers: string[] = [];

  for (const cat of CATEGORIES) {
    const strongHits = cat.strong.filter((re) => re.test(text)).map((re) => re.source);
    const weakHits = cat.weak.filter((re) => re.test(text)).map((re) => re.source);
    totalStrong += strongHits.length;
    totalWeak += weakHits.length;
    triggers.push(...strongHits, ...weakHits);
    if (strongHits.length > 0 && (!best || strongHits.length > best.strongHits.length)) {
      best = { id: cat.id, label: cat.label, strongHits };
    }
  }

  if (!best) return null;

  const isBrand =
    best.id === 'brand_watch' || /house\s?sigma|mongohouse|bungol|zealty|\bwahi\b|pure\s?property/i.test(text);
  if (!sub.geoImplied && !city && !isBrand) return null;

  const score = totalStrong * 3 + totalWeak + (item.title.includes('?') ? 1 : 0) + (city ? 1 : 0);
  if (best.id !== 'brand_watch' && score < SCORE_THRESHOLD) return null;

  const tpl = TEMPLATES[best.id] ?? TEMPLATES.tool_rec;
  return {
    ...item,
    category: best.id,
    categoryLabel: best.label,
    score,
    triggers: [...new Set(triggers)],
    city,
    draftPersonal: fillTemplate(pickVariant(tpl.personalVariants, tpl.personal, item.id), city),
    draftCompany: fillTemplate(tpl.company, city),
  };
}

/**
 * Deterministic string hash (FNV-1a). Same thread always gets the same draft, so
 * re-running the monitor never changes a reply you already half-wrote — but two
 * different threads in the same category get different wording.
 */
function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Rotate through the category's phrasings so no two replies read identically.
 *
 * The risk this addresses isn't that a draft sounds robotic — it's that posting
 * the same paragraph on five threads gets them lined up side by side, and then
 * the account reads as a bot regardless of how good the writing was.
 */
export function pickVariant(variants: string[] | undefined, fallback: string, seed: string): string {
  if (!variants || variants.length === 0) return fallback;
  return variants[hashString(seed) % variants.length];
}

/** Replace {{city}} with the detected place (or a neutral fallback). */
export function fillTemplate(tpl: string, city: string | null): string {
  return tpl.replace(/\{\{city\}\}/g, city ?? 'your market');
}

// ---------------------------------------------------------------------------
// Atom (RSS) parsing — fallback transport. Reddit's Atom feeds are small and
// regular, so a regex extractor beats adding an XML dependency for a fallback
// path. The OAuth JSON transport is the production one.
// ---------------------------------------------------------------------------

const ENTITIES: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'", '&apos;': "'", '&#32;': ' ',
};

export function decodeEntities(s: string): string {
  return s
    .replace(/&(amp|lt|gt|quot|#39|#x27|apos|#32);/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

/** Crude but sufficient: strip tags from Reddit's content HTML, keep the text. */
export function stripHtml(html: string): string {
  return decodeEntities(
    decodeEntities(html) // Atom double-escapes: content is HTML that is itself entity-encoded
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  ).replace(/\n{3,}/g, '\n\n').trim();
}

function tag(block: string, name: string): string {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1].trim() : '';
}

/**
 * Parse a Reddit Atom feed into RedditItems. Works for /new/.rss (posts),
 * /comments/.rss (comments) and search.rss. Entries that can't yield a t1_/t3_
 * id are dropped rather than guessed.
 */
export function parseAtomFeed(xml: string, fallbackSubreddit: string): RedditItem[] {
  const items: RedditItem[] = [];
  const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? [];
  for (const e of entries) {
    const rawId = tag(e, 'id');
    const idMatch = rawId.match(/t[13]_[a-z0-9]+/i);
    if (!idMatch) continue;
    const id = idMatch[0];
    const kind: RedditItem['kind'] = id.startsWith('t1_') ? 'comment' : 'post';

    const linkMatch = e.match(/<link[^>]*href="([^"]+)"/i);
    const permalink = linkMatch ? decodeEntities(linkMatch[1]) : '';
    const subMatch = permalink.match(/\/r\/([^/]+)\//);

    const title = decodeEntities(tag(e, 'title'));
    const author = tag(e, 'name').replace(/^\/u\//, '');
    const published = tag(e, 'published') || tag(e, 'updated');
    const body = stripHtml(tag(e, 'content'));

    items.push({
      id,
      kind,
      subreddit: subMatch ? subMatch[1] : fallbackSubreddit,
      author,
      // Comment feed titles read "/u/author on Post Title" — keep the post title part.
      title: kind === 'comment' ? title.replace(/^\/u\/\S+\s+on\s+/i, '') : title,
      body,
      permalink,
      createdUtc: published ? new Date(published) : new Date(0),
    });
  }
  return items;
}

/** Age in whole hours, clamped at 0 (clock skew happens). */
export function ageHours(item: RedditItem, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - item.createdUtc.getTime()) / 3_600_000));
}
