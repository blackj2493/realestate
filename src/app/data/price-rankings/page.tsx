import type { Metadata } from "next";
import { getMarketBoard } from "@/lib/data/marketBoard";
import { TrackerShell } from "@/components/data/TrackerShell";
import { trackerBySlug } from "@/lib/data/trackers";
import { ogImageUrl } from "@/lib/og/ogImageUrl";
import { PriceRankingsBoard } from "./PriceRankingsBoard";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");
export const revalidate = 3600;

const SLUG = "price-rankings";
const DEF = trackerBySlug(SLUG)!;

const H1 = "GTA & Toronto Home Price Rankings";
const TITLE = "GTA & Toronto Home Price Rankings — Median & Average Sold Prices by Market";
const DESCRIPTION =
  "Median and average sold prices for Toronto, Ottawa and every GTA market, ranked — with year-over-year change, price per square foot and sold-to-list ratio. Updated nightly from MLS® sold data.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: `${TITLE} | PureProperty`,
  description: DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/data/${SLUG}` },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: `${SITE_URL}/data/${SLUG}`,
    siteName: "PureProperty",
    type: "website",
    images: [
      ogImageUrl({
        eyebrow: DEF.eyebrow,
        title: "GTA Home Price Rankings",
        subtitle: "Median & average sold prices by market.",
      }),
    ],
  },
};

export default async function PriceRankingsPage() {
  const board = await getMarketBoard();
  const rows = board.rows.filter((r) => r.medianPrice != null);

  return (
    <TrackerShell
      slug={SLUG}
      eyebrow={DEF.eyebrow}
      title={H1}
      description={DESCRIPTION}
      crumbs={[{ name: "Home", href: "/" }, { name: "Data", href: "/data" }, { name: "Price Rankings" }]}
      dataAsOf={board.dataAsOf}
      methodology={
        <>
          <p>
            <strong>Median</strong> and <strong>Average</strong> are the most recent full month of MLS® sold
            prices in each market (all residential property types). We surface both because they answer
            different questions — the median is the typical home, while the average (which TRREB and CREA
            headline) is pulled higher by luxury sales, especially in the detached-heavy 905.
          </p>
          <p>
            <strong>YoY</strong> is the 3-month-smoothed change in median versus a year earlier;{" "}
            <strong>$/Sqft</strong> is the median sold price per square foot; <strong>Sold / List</strong> is
            the average sale price as a percent of asking (over 100% = selling above ask). Sold figures come
            from the MLS® VOW feed — comprehensive but not exhaustive — so counts are directional. Refreshed
            nightly.
          </p>
        </>
      }
      faqs={[
        {
          q: "Why show both median and average price?",
          a: "The median is the middle sale — the typical home — while the average is skewed upward by high-end sales. TRREB and CREA headline the average, so we show both so you can compare like-for-like and see the gap, which is widest in luxury-heavy markets.",
        },
        {
          q: "Is this the sold price or the asking price?",
          a: "Sold price. Every figure is drawn from completed MLS® sales in the most recent month, not list prices.",
        },
        {
          q: "How is year-over-year change calculated?",
          a: "We compare the median sold price to the same period a year earlier, smoothed over three months to reduce noise from thin months, aligning months by label rather than position.",
        },
        {
          q: "Which markets are ranked?",
          a: "Toronto and Ottawa plus the GTA municipalities — Mississauga, Brampton, Markham, Vaughan, Richmond Hill, Oakville, Burlington, Milton, Oshawa, Whitby, Ajax, Pickering and Hamilton.",
        },
      ]}
    >
      {rows.length > 0 ? (
        <PriceRankingsBoard rows={rows} />
      ) : (
        <p className="rounded-md border border-border bg-card/40 p-6 text-sm text-muted-foreground">
          Price data is refreshing — please check back shortly.
        </p>
      )}
    </TrackerShell>
  );
}
