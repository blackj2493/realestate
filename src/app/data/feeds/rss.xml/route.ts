/**
 * /data/feeds/rss.xml — the data desk's master feed.
 *
 * WHAT IS IN IT: every published finding (permanent, dated, a real permalink) plus ONE
 * dated item per nightly refresh carrying the day's leader on each tracker.
 *
 * WHY ONE DAILY ITEM AND NOT EIGHT. The master feed is what a curator or a reporter
 * subscribes to, and the fastest way to lose one is to file fifty items a day. The per
 * tracker feeds under /data/feeds/tracker/<slug>/rss.xml carry the full ranking for
 * anyone who wants one subject daily; this feed carries the front page.
 */

import { LIVE_FINDINGS } from "@/lib/data/findings";
import { LIVE_TRACKERS } from "@/lib/data/trackers";
import { getTrackerRanking } from "@/lib/data/trackerFeeds";
import { renderRss, rssResponse, feedDate, dataDateKey, type FeedItem } from "@/lib/data/rss";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");
export const revalidate = 3600;

export async function GET() {
  const rankings = await Promise.all(LIVE_TRACKERS.map((t) => getTrackerRanking(t.slug)));
  const live = rankings.filter((r): r is NonNullable<typeof r> => r != null && r.entries.length > 0);

  const items: FeedItem[] = LIVE_FINDINGS.map((f) => ({
    title: f.title,
    link: `${SITE_URL}/data/findings/${f.slug}`,
    description: f.standfirst,
    guid: `${SITE_URL}/data/findings/${f.slug}`,
    isPermaLink: true,
    pubDate: feedDate(f.updated ?? f.published),
    category: "Finding",
  }));

  // The newest stamp across every board is the day this reading belongs to.
  const asOf = live.reduce<string | null>(
    (acc, r) => (r.dataAsOf && (!acc || r.dataAsOf > acc) ? r.dataAsOf : acc),
    null
  );

  if (live.length > 0) {
    const key = dataDateKey(asOf);
    const lines = live.map((r) => {
      const lead = r.entries[0];
      return `${r.title}: ${lead.label} — ${lead.display} (${r.rankedBy.toLowerCase()}).`;
    });
    items.unshift({
      title: `Ontario market readings — ${key}`,
      link: `${SITE_URL}/data`,
      description: `${lines.join(" ")} Full rankings for every market update nightly at ${SITE_URL}/data.`,
      guid: `${SITE_URL}/data#${key}`,
      isPermaLink: false,
      pubDate: feedDate(asOf),
      category: "Daily reading",
    });
  }

  return rssResponse(
    renderRss({
      title: "PureProperty Data Desk — Ontario housing market",
      description:
        "Nightly market readings and dated analysis across Toronto, Ottawa and every GTA market: price cuts, days on market, sold-to-list, rents and yields. Computed from MLS® data.",
      selfUrl: `${SITE_URL}/data/feeds/rss.xml`,
      link: `${SITE_URL}/data`,
      items,
      lastBuildDate: asOf ? feedDate(asOf) : null,
    })
  );
}
