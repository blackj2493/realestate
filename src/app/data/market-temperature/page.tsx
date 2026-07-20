import type { Metadata } from "next";
import { getMarketBoard } from "@/lib/data/marketBoard";
import { TrackerShell } from "@/components/data/TrackerShell";
import { trackerBySlug } from "@/lib/data/trackers";
import { ogImageUrl } from "@/lib/og/ogImageUrl";
import { MarketTemperatureBoard } from "./MarketTemperatureBoard";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");
export const revalidate = 3600;

const SLUG = "market-temperature";
const DEF = trackerBySlug(SLUG)!;

const H1 = "GTA & Toronto Market Temperature";
const TITLE = "GTA & Toronto Market Temperature — Buyer's or Seller's Market by City";
const DESCRIPTION =
  "Is it a buyer's or seller's market? Every Toronto, Ottawa and GTA city scored from months of supply and sold-to-list ratio, with sell-through. Updated nightly from MLS® data.";

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
        title: "GTA Market Temperature",
        subtitle: "Buyer's or seller's market, by city.",
      }),
    ],
  },
};

export default async function MarketTemperaturePage() {
  const board = await getMarketBoard();
  const rows = board.rows.filter((r) => r.temperature != null);

  return (
    <TrackerShell
      slug={SLUG}
      eyebrow={DEF.eyebrow}
      title={H1}
      description={DESCRIPTION}
      crumbs={[{ name: "Home", href: "/" }, { name: "Data", href: "/data" }, { name: "Market Temperature" }]}
      dataAsOf={board.dataAsOf}
      methodology={
        <>
          <p>
            Each market is scored <strong>Seller&apos;s</strong>, <strong>Balanced</strong> or{" "}
            <strong>Buyer&apos;s</strong> primarily from its <strong>sold-to-list ratio</strong> (sale price
            vs asking), with <strong>months of supply</strong> as a secondary signal. A market reads
            Seller&apos;s when homes sell at or above ask with tight supply, and Buyer&apos;s when they sell
            below ask. Sold-to-list is the primary driver because it responds faster and is less distorted by
            inventory quirks than supply alone.
          </p>
          <p>
            <strong>Months of supply</strong> is active listings divided by the recent monthly sales pace.{" "}
            <strong>Sell-through</strong> is the share of listings that actually sold (rather than being
            withdrawn) over the past year. Some markets (e.g. Ottawa) show sell-through as N/A where the
            withdrawn-listing feed doesn&apos;t cleanly cover them, rather than showing a misleading number.
            Refreshed nightly.
          </p>
        </>
      }
      faqs={[
        {
          q: "What makes a buyer's vs. seller's market?",
          a: "A seller's market has more buyers than homes: properties sell quickly, often at or above asking. A buyer's market has more homes than buyers: properties sit longer and sell below asking. We score each market from its sold-to-list ratio and months of supply.",
        },
        {
          q: "What is 'months of supply'?",
          a: "The number of months it would take to sell all the active listings at the current sales pace. Under ~4 months typically favours sellers; over ~8 months favours buyers.",
        },
        {
          q: "Why is one market's sell-through shown as N/A?",
          a: "Sell-through needs the withdrawn/de-listed feed to identify listings that didn't sell. For a few areas (notably Ottawa) that feed doesn't map cleanly to the market, so we show N/A rather than a number that would look like a perfect 100%.",
        },
        {
          q: "Which markets are scored?",
          a: "Toronto and Ottawa plus the GTA municipalities — Mississauga, Brampton, Markham, Vaughan, Richmond Hill, Oakville, Burlington, Milton, Oshawa, Whitby, Ajax, Pickering and Hamilton.",
        },
      ]}
    >
      {rows.length > 0 ? (
        <MarketTemperatureBoard rows={rows} />
      ) : (
        <p className="rounded-md border border-border bg-card/40 p-6 text-sm text-muted-foreground">
          Market data is refreshing — please check back shortly.
        </p>
      )}
    </TrackerShell>
  );
}
