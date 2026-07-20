import type { Metadata } from "next";
import { getMarketBoard } from "@/lib/data/marketBoard";
import { TrackerShell } from "@/components/data/TrackerShell";
import { trackerBySlug } from "@/lib/data/trackers";
import { ogImageUrl } from "@/lib/og/ogImageUrl";
import { PriceCutsBoard } from "./PriceCutsBoard";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");
export const revalidate = 3600;

const SLUG = "price-cuts";
const DEF = trackerBySlug(SLUG)!;

const H1 = "GTA & Toronto Price-Cut Tracker";
const TITLE = "GTA & Toronto Price-Cut Tracker — % of Listings Reducing Their Price";
const DESCRIPTION =
  "See what share of active listings have cut their asking price in Toronto, Ottawa and every GTA market — plus how big the typical reduction is. A live read on which markets are cooling. Updated nightly from MLS® data.";

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
        title: "GTA Price-Cut Tracker",
        subtitle: "Where sellers are dropping their asking price.",
      }),
    ],
  },
};

export default async function PriceCutsPage() {
  const board = await getMarketBoard();
  const rows = board.rows.filter((r) => r.cutShare != null);

  return (
    <TrackerShell
      slug={SLUG}
      eyebrow={DEF.eyebrow}
      title={H1}
      description={DESCRIPTION}
      crumbs={[{ name: "Home", href: "/" }, { name: "Data", href: "/data" }, { name: "Price-Cut Tracker" }]}
      dataAsOf={board.dataAsOf}
      methodology={
        <>
          <p>
            We scan every active for-sale listing in each market and flag those whose current asking price is
            below their original list price (a reduction between 0.5% and 60%, to exclude data errors and
            relist artifacts). <strong>% Cutting Price</strong> is the share of active listings with a
            reduction; <strong>Median Cut</strong> is the median size of that reduction among the listings
            that cut.
          </p>
          <p>
            Counts come from the MLS® VOW feed — a comprehensive but not exhaustive subset of the market — so
            treat the absolute listing counts as directional. Figures exclude sold, leased and terminated
            listings, and refresh nightly.
          </p>
        </>
      }
      faqs={[
        {
          q: "What counts as a price cut?",
          a: "A price cut is an active for-sale listing whose current asking price is lower than its original list price. We count the share of active listings in each market with at least one such reduction.",
        },
        {
          q: "How often is the price-cut data updated?",
          a: "The tracker refreshes from live MLS® data every night, so it reflects the current state of the market rather than a monthly snapshot.",
        },
        {
          q: "Which markets are covered?",
          a: "Toronto and Ottawa plus the Greater Toronto Area municipalities — Mississauga, Brampton, Markham, Vaughan, Richmond Hill, Oakville, Burlington, Milton, Oshawa, Whitby, Ajax, Pickering and Hamilton.",
        },
        {
          q: "Can I use this data on my own site?",
          a: "Yes. The tracker is free to cite and embed — use the “Embed this” button to place the live table on your site with a link back to PureProperty.",
        },
      ]}
    >
      {rows.length > 0 ? (
        <PriceCutsBoard rows={rows} />
      ) : (
        <p className="rounded-md border border-border bg-card/40 p-6 text-sm text-muted-foreground">
          Price-cut data is refreshing — please check back shortly.
        </p>
      )}
    </TrackerShell>
  );
}
