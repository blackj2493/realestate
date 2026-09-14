/**
 * /data/feeds/city/<slug>/rss.xml — one market, every region-grade reading, nightly.
 *
 * WHY PER-CITY FEEDS EXIST. Broadcasting fifty markets at one audience is what gets a
 * channel muted. A feed per market inverts it: a reader in Vaughan subscribes to Vaughan
 * and never sees Ottawa. It is also the only shape a local reporter or a community group
 * will actually take, because it is about their patch and nothing else.
 *
 * Each reading carries the market's STANDING against every other market we cover, because
 * "6.1%" means nothing on its own and "6.1%, 2nd of 41" is a story.
 */

import { notFound } from "next/navigation";
import { BOARD_MARKETS } from "@/lib/data/marketBoard";
import { getCityFeed } from "@/lib/data/trackerFeeds";
import { slugify } from "@/lib/listings/listingPath";
import { renderRss, rssResponse, feedDate, dataDateKey, type FeedItem } from "@/lib/data/rss";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");

export const revalidate = 3600;
export const dynamicParams = false;

/** slug → the exact region string the board is keyed by. */
const REGION_BY_SLUG = new Map(BOARD_MARKETS.map((r) => [slugify(r), r]));

export function generateStaticParams() {
  return [...REGION_BY_SLUG.keys()].map((slug) => ({ slug }));
}

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const region = REGION_BY_SLUG.get(slug);
  if (!region) notFound();

  const feed = await getCityFeed(region);
  if (!feed || feed.readings.length === 0) notFound();

  const key = dataDateKey(feed.dataAsOf);
  const headline = feed.readings[0];
  const body = feed.readings
    .map((r) => (r.rank === "—" ? `${r.label}: ${r.value}.` : `${r.label}: ${r.value} (${r.rank} markets).`))
    .join(" ");

  const items: FeedItem[] = [
    {
      title: `${region} housing market — ${key}`,
      link: `${SITE_URL}/data`,
      description: `${region}: ${headline.label} ${headline.value}. ${body} Updated nightly from MLS® data at ${SITE_URL}/data.`,
      guid: `${SITE_URL}/data/feeds/city/${slug}#${key}`,
      isPermaLink: false,
      pubDate: feedDate(feed.dataAsOf),
      category: region,
    },
  ];

  return rssResponse(
    renderRss({
      title: `PureProperty — ${region} housing market`,
      description: `Nightly ${region} market readings: median sold price, price cuts, days to sell, sold-to-list and rental yield, each ranked against every other Ontario market we cover.`,
      selfUrl: `${SITE_URL}/data/feeds/city/${slug}/rss.xml`,
      link: `${SITE_URL}/data`,
      items,
      lastBuildDate: feedDate(feed.dataAsOf),
    })
  );
}
