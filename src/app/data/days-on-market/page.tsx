import type { Metadata } from "next";
import { getMarketBoard } from "@/lib/data/marketBoard";
import { TrackerShell } from "@/components/data/TrackerShell";
import { trackerBySlug } from "@/lib/data/trackers";
import { ogImageUrl } from "@/lib/og/ogImageUrl";
import { DaysOnMarketBoard } from "./DaysOnMarketBoard";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");
export const revalidate = 3600;

const SLUG = "days-on-market";
const DEF = trackerBySlug(SLUG)!;

const H1 = "GTA & Toronto Days-on-Market Leaderboard";
const TITLE = "GTA & Toronto Days-on-Market Leaderboard — How Fast Homes Sell";
const DESCRIPTION =
  "How fast homes sell in Toronto, Ottawa and every GTA market — median days to sell, the typical range, and how much active inventory is sitting 90+ days. Updated nightly from MLS® data.";

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
        title: "GTA Days-on-Market Leaderboard",
        subtitle: "How fast homes sell, by market.",
      }),
    ],
  },
};

export default async function DaysOnMarketPage() {
  const board = await getMarketBoard();
  const rows = board.rows.filter((r) => r.soldMedianDom != null);

  return (
    <TrackerShell
      slug={SLUG}
      eyebrow={DEF.eyebrow}
      title={H1}
      description={DESCRIPTION}
      crumbs={[{ name: "Home", href: "/" }, { name: "Data", href: "/data" }, { name: "Days on Market" }]}
      dataAsOf={board.dataAsOf}
      methodology={
        <>
          <p>
            <strong>Median Days to Sell</strong> is the median number of days a recently-sold home spent on
            the market, computed from MLS® sales over the trailing period and adjusted for relists (a
            withdrawn-and-relisted home keeps its true clock rather than resetting to zero). The{" "}
            <strong>25–75% range</strong> shows how spread-out that is.
          </p>
          <p>
            <strong>Active Listing Age</strong> and <strong>Sitting 90+ Days</strong> describe the current
            unsold inventory — the median age of listings on the market now, and the share that have been
            listed 90+ days. A market can sell its fresh listings quickly while a tail of stale inventory
            lingers, so the two tell different halves of the story. Sold figures come from the MLS® VOW feed
            (comprehensive but not exhaustive); refreshed nightly.
          </p>
        </>
      }
      faqs={[
        {
          q: "What does 'days to sell' mean?",
          a: "It's the median number of days a home that recently sold had been listed before going firm — a measure of how quickly the market is absorbing homes. Lower is faster.",
        },
        {
          q: "Why is 'active listing age' higher than 'days to sell'?",
          a: "Days to sell only counts homes that sold; active listing age counts everything still on the market, which is dragged up by a tail of harder-to-sell listings that haven't found a buyer yet.",
        },
        {
          q: "How is this different from the number my agent quotes?",
          a: "Many sources reset days-on-market to zero when a listing is withdrawn and relisted, understating the true time on market. We stitch relists back together, so our figure reflects the real clock.",
        },
        {
          q: "Which markets are covered?",
          a: "Toronto and Ottawa plus the GTA municipalities — Mississauga, Brampton, Markham, Vaughan, Richmond Hill, Oakville, Burlington, Milton, Oshawa, Whitby, Ajax, Pickering and Hamilton.",
        },
      ]}
    >
      {rows.length > 0 ? (
        <DaysOnMarketBoard rows={rows} />
      ) : (
        <p className="rounded-md border border-border bg-card/40 p-6 text-sm text-muted-foreground">
          Days-on-market data is refreshing — please check back shortly.
        </p>
      )}
    </TrackerShell>
  );
}
