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
            <strong>Typical Sale Window</strong> shows how spread-out that is: a quarter of sales were
            faster than the first figure and a quarter slower than the second, so exactly half landed
            between them.
          </p>
          <p>
            <strong>Reported Listing Age</strong> is the median age of the homes on the market now, measured
            the way the boards measure it — from the current listing&rsquo;s start date. When a home is
            withdrawn and re-listed it gets a new MLS® number, and that clock restarts at zero.{" "}
            <strong>True Days on Market</strong> is the same set of homes with those relist chains stitched
            back together: consecutive sale campaigns on one property are joined when the gap between one ending
            and the next beginning is 35 days or less, so the clock keeps running across the break.{" "}
            <strong>Hidden Days</strong> is the difference — how much longer these homes have actually been
            for sale than the reported figure shows.
          </p>
          <p>
            The 35-day join is deliberately conservative. A longer gap is treated as a genuinely new
            marketing effort and is <em>not</em> stitched, and a campaign whose end date the feed never
            supplied is never stitched across at all. Both choices push the real figure down, not up.
          </p>
          <p>
            <strong>Sitting 90+ Days</strong> is the share of current listings whose true days on market is 90 or
            more. A market can sell its fresh listings quickly while a tail of stale inventory lingers, so
            these measures tell different halves of the story. Sold figures come from the MLS® VOW feed
            (comprehensive but not exhaustive); refreshed nightly.
          </p>
        </>
      }
      faqs={[
        {
          q: "What does 'median days to sell' mean?",
          a: "It's the median number of days a home that recently sold had been listed before going firm — a measure of how quickly the market is absorbing homes. Lower is faster.",
        },
        {
          q: "Why is 'true days on market' higher than 'reported listing age'?",
          a: "Because a re-listed home starts a fresh clock. When a property is withdrawn and put back on the market it is issued a new MLS® number, and days-on-market resets to zero — so a home showing '3 days' may have been for sale for months. We stitch consecutive campaigns on the same property back together (joining gaps of 35 days or less), which is why our figure is higher. The gap between the two columns is the part the reset hides.",
        },
        {
          q: "Why is 'true days on market' higher than 'median days to sell'?",
          a: "Median days to sell only counts homes that sold; true days on market counts everything still for sale, which is dragged up by a tail of harder-to-sell listings that haven't found a buyer yet. They are two different sets of houses, which is why the table groups them separately.",
        },
        {
          q: "How is this different from the number my agent quotes?",
          a: "Most sources quote the reported figure — the one that resets on relist. Both are shown here side by side so you can see the difference for yourself, market by market.",
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
