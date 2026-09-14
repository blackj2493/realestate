/**
 * /data/feeds/tracker/<slug>/rss.xml — one tracker, ranked, nightly.
 *
 * This is the feed that carries the "top 5" content: each nightly refresh files one item
 * holding the day's leaders on that tracker, and every finding written off the same
 * tracker sits alongside it as a permalink.
 *
 * The item GUID is keyed to the DATA date, not the request time. A reader who polls this
 * feed hourly sees one new item a day, which is the only cadence a subscriber tolerates.
 */

import { notFound } from "next/navigation";
import { LIVE_TRACKERS, trackerBySlug } from "@/lib/data/trackers";
import { findingsForTracker } from "@/lib/data/findings";
import { getTrackerRanking } from "@/lib/data/trackerFeeds";
import { renderRss, rssResponse, feedDate, dataDateKey, type FeedItem } from "@/lib/data/rss";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");
/** How many markets one daily item names. Enough to be useful, short enough to read. */
const TOP_N = 5;

export const revalidate = 3600;
export const dynamicParams = false;

export function generateStaticParams() {
  return LIVE_TRACKERS.map((t) => ({ slug: t.slug }));
}

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const def = trackerBySlug(slug);
  const ranking = await getTrackerRanking(slug);
  if (!def || !ranking) notFound();

  const items: FeedItem[] = findingsForTracker(slug).map((f) => ({
    title: f.title,
    link: `${SITE_URL}/data/findings/${f.slug}`,
    description: f.standfirst,
    guid: `${SITE_URL}/data/findings/${f.slug}`,
    isPermaLink: true,
    pubDate: feedDate(f.updated ?? f.published),
    category: "Finding",
  }));

  const top = ranking.entries.slice(0, TOP_N);
  if (top.length > 0) {
    const key = dataDateKey(ranking.dataAsOf);
    const body = top.map((e, i) => `${i + 1}. ${e.label} — ${e.display} · ${e.detail}`).join("  ");
    items.unshift({
      title: `${def.title}: ${top[0].label} leads at ${top[0].display} — ${key}`,
      link: `${SITE_URL}/data/${slug}`,
      description: `${ranking.rankedBy}, across ${ranking.entries.length} Ontario markets. ${body}  Full ranking: ${SITE_URL}/data/${slug}`,
      guid: `${SITE_URL}/data/${slug}#${key}`,
      isPermaLink: false,
      pubDate: feedDate(ranking.dataAsOf),
      category: def.eyebrow,
    });
  }

  return rssResponse(
    renderRss({
      title: `PureProperty — ${def.title}`,
      description: `${def.tagline} Updated nightly from MLS® data.`,
      selfUrl: `${SITE_URL}/data/feeds/tracker/${slug}/rss.xml`,
      link: `${SITE_URL}/data/${slug}`,
      items,
      lastBuildDate: ranking.dataAsOf ? feedDate(ranking.dataAsOf) : null,
    })
  );
}
