/**
 * Campaign tags for the links inside an email (engagement plan Step 2).
 *
 * WHY THIS EXISTS. §9 of docs/strategy/2026-08-28-weekly-data-drop.md names "click to
 * terminal above 8%" as the program's real KPI: the point is a return visit, not an open.
 * Every link the Data Drop was built with is a bare URL, so a click arrives as ordinary
 * direct traffic and that KPI cannot be read at all. Attribution has to ride the link —
 * nothing reconstructs it afterwards, so a week sent untagged is a week measured never.
 *
 * THE CONVENTION, so every stream reports into one scheme rather than inventing its own:
 *
 *   utm_source    the stream that sent it     data_drop, alerts_digest, onboarding
 *   utm_medium    always "email"
 *   utm_campaign  the individual send         2026-w36 — this is what compares week to week
 *   utm_content   which link in that email    cta, tracker-price-cuts, chip-toronto
 *
 * Putting the ISO week in `campaign` rather than in `content` is the load-bearing choice.
 * It makes "did week 3 beat week 2" a group-by instead of a string parse, and it keeps
 * `content` free to answer the question the ladder actually raises: which BLOCK of the
 * email earns the click — the headline CTA, a source link, or a market chip.
 *
 * NEVER TAG AN UNSUBSCRIBE LINK. It is a compliance control, not a campaign destination,
 * and mail scanners fire it unattended. Tagged, those unattended fetches would report as
 * engagement — inflating the one number this module exists to measure honestly.
 */

export interface UtmTags {
  /** The stream that sent the mail. Becomes `utm_source`. */
  source: string;
  /** The individual send. Becomes `utm_campaign` — the ISO week id for a weekly. */
  campaign: string;
  /** Which link within that email. Becomes `utm_content`. */
  content: string;
}

/**
 * Lowercase, ASCII, hyphen-joined. Analytics tools group by exact string, so
 * "Richmond Hill" and "richmond-hill" would otherwise split one market across two rows.
 *
 * UNDERSCORES SURVIVE. `utm_source` carries the stream key verbatim (`data_drop`), which is
 * also the `email_prefs` column name and the `streams.ts` key — so an analytics row joins to
 * the preference table with no translation step in between.
 */
const slug = (s: string): string =>
  s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "-")
    .replace(/^-+|-+$/g, "");

/**
 * Append the four campaign parameters to an absolute URL, preserving everything already
 * on it. `set` rather than `append`, so re-tagging a URL is idempotent rather than
 * additive — a link cannot accumulate two `utm_source` values however it is composed.
 *
 * A relative or malformed href is returned UNCHANGED rather than thrown on. A renderer
 * must never fail a whole send over a link it could not tag.
 */
export function withUtm(href: string, tags: UtmTags): string {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return href;
  }
  url.searchParams.set("utm_source", slug(tags.source));
  url.searchParams.set("utm_medium", "email");
  url.searchParams.set("utm_campaign", slug(tags.campaign));
  url.searchParams.set("utm_content", slug(tags.content));
  return url.toString();
}

/** Curried form for a renderer that tags many links against one send. */
export const utmTagger =
  (source: string, campaign: string) =>
  (href: string, content: string): string =>
    withUtm(href, { source, campaign, content });
