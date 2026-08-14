import type { Metadata } from "next";
import { getRentBoard } from "@/lib/data/rentBoard";
import { TrackerShell } from "@/components/data/TrackerShell";
import { trackerBySlug } from "@/lib/data/trackers";
import { ogImageUrl } from "@/lib/og/ogImageUrl";
import { RentsBoard } from "./RentsBoard";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");
export const revalidate = 3600;

const SLUG = "rents";
const DEF = trackerBySlug(SLUG)!;

const H1 = "What Homes Actually Rent For — Toronto, Ottawa & the GTA";
const TITLE = "What Homes Actually Rent For — Median Closed Rent by Neighbourhood";
const DESCRIPTION =
  "Median rent that leases actually closed at, by neighbourhood, for houses and condos across Toronto, Ottawa and the GTA. Closed prices from MLS® data — not asking rents. Updated nightly.";

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
        title: "What Homes Actually Rent For",
        subtitle: "Closed rents by neighbourhood — houses and condos.",
      }),
    ],
  },
};

export default async function RentsPage() {
  const board = await getRentBoard();

  return (
    <TrackerShell
      slug={SLUG}
      eyebrow={DEF.eyebrow}
      title={H1}
      description={DESCRIPTION}
      crumbs={[{ name: "Home", href: "/" }, { name: "Data", href: "/data" }, { name: "Closed Rents" }]}
      dataAsOf={board.dataAsOf}
      methodology={
        <>
          <p>
            Every figure here is a <strong>closed rent</strong> — the price a lease actually signed at,
            taken from MLS® lease records once the deal completed. That is a different thing from the
            asking rents carried by rental listing sites, which show what a landlord hoped for rather than
            what a tenant paid.
          </p>
          <p>
            We report the <strong>median</strong>, never the average: a handful of $14,000 executive
            leases would drag an average and tell you nothing about the market. Alongside it we show the
            25th–75th percentile range, the typical bedroom count, and the number of leases behind the
            figure. A median rent is meaningless without knowing what size of home it describes, so the
            bedroom count travels with it.
          </p>
          <p>
            Neighbourhoods appear once they have at least five closed leases in the trailing 12 months.
            Anything under ten is flagged in amber — we show it with its count rather than hiding it,
            because suppressing thin rows quietly erases smaller communities, but treat those as
            indicative only.
          </p>
          <p>
            <strong>Year-over-year</strong> compares the trailing 12 months against the same window a year
            earlier, and is left blank unless <em>both</em> periods have at least twenty leases. A thin
            prior year can otherwise manufacture a dramatic-looking percentage out of noise.
          </p>
          <p>
            One caveat on that figure, because it is the one most likely to mislead. It compares medians
            across <em>all</em> bedroom counts, so it moves when a neighbourhood&apos;s <strong>mix</strong>{" "}
            changes, not only when rents do. An area that leased mostly four-bedroom houses last year and
            mostly two-bedroom ones this year will show a fall even if every individual home rented for the
            same price. Across the board the year-over-year figures sit in a tight band — a median of −2.5%
            for houses, with the middle half between −6.5% and +1.0% — but a handful of neighbourhoods swing
            past ±25%, and composition is the first thing to check before quoting one of those. For a
            like-for-like read, use the per-bedroom breakdown, and ask us if you want it cut that way.
          </p>
          <p>
            &ldquo;Houses&rdquo; means detached, semi-detached, townhouse, duplex and multiplex homes;
            &ldquo;Condos&rdquo; means condo apartments, condo townhouses and co-ops. The split matters:{" "}
            <strong>
              TRREB&apos;s quarterly rental report covers condo apartments only, so there is no published
              figure anywhere for what a house rents for.
            </strong>{" "}
            CMHC covers purpose-built rental buildings, and the rental portals carry asking prices. This is
            the gap those three leave.
          </p>
          <p>
            Two honest limits. Our feed is a large subset of the Ontario market rather than all of it, so
            we publish medians and proportions — never counts of how many homes were leased. And homes
            rented privately, outside MLS®, are not here at all; in some neighbourhoods that is a
            meaningful share of the market.
          </p>
        </>
      }
      faqs={[
        {
          q: "Is this asking rent or the rent people actually pay?",
          a: "The rent actually paid. Each figure comes from a completed MLS® lease record, so it reflects the signed price rather than the advertised one. Rental listing sites generally show asking rents.",
        },
        {
          q: "Why does this differ from TRREB's rental report?",
          a: "TRREB publishes average rents for condo apartments, quarterly, at region level. This covers houses as well as condos, uses medians rather than averages, breaks down by neighbourhood, and updates nightly. Different population and different statistic — not a correction of theirs.",
        },
        {
          q: "Why do some neighbourhoods show no year-over-year change?",
          a: "Because either the current or prior 12-month window had fewer than twenty closed leases. A percentage drawn from a handful of leases moves on noise, so we leave it blank rather than publish something that reads more precisely than it is.",
        },
        {
          q: "Can I use these numbers?",
          a: "Yes — they are free to quote, chart and embed, with a credit and link to PureProperty.ca. Journalists can request a custom cut at /data/for-journalists.",
        },
      ]}
    >
      <RentsBoard rows={board.rows} />
    </TrackerShell>
  );
}
