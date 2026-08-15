import type { Metadata } from "next";
import { Suspense } from "react";
import { getCompetitionBoard } from "@/lib/data/competitionBoard";
import { TrackerShell } from "@/components/data/TrackerShell";
import { trackerBySlug } from "@/lib/data/trackers";
import { ogImageUrl } from "@/lib/og/ogImageUrl";
import { OverAskingBoard } from "./OverAskingBoard";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");
export const revalidate = 3600;

const SLUG = "over-asking";
const DEF = trackerBySlug(SLUG)!;

const H1 = "How Often Homes Sell Over Asking — Toronto, Ottawa & the GTA";
const TITLE = "How Often Homes Sell Over Asking — By Neighbourhood";
const DESCRIPTION =
  "The share of Ontario home sales that closed above the seller's asking price, by neighbourhood, for houses and condos — plus how much above. Closed MLS® sale prices, updated nightly.";

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
        title: "How Often Homes Sell Over Asking",
        subtitle: "The over-ask rate by neighbourhood — houses and condos.",
      }),
    ],
  },
};

export default async function OverAskingPage() {
  const board = await getCompetitionBoard();

  return (
    <TrackerShell
      slug={SLUG}
      eyebrow={DEF.eyebrow}
      title={H1}
      description={DESCRIPTION}
      crumbs={[{ name: "Home", href: "/" }, { name: "Data", href: "/data" }, { name: "Sold Over Asking" }]}
      dataAsOf={board.dataAsOf}
      methodology={
        <>
          <p>
            Every figure here compares a home&apos;s <strong>closed sale price</strong> against the{" "}
            <strong>final asking price</strong> on the same listing — both taken from the MLS® record
            once the deal completed. &ldquo;Sold over asking&rdquo; means the sale price was higher than
            that final ask, which is what the phrase means in ordinary speech.
          </p>
          <p>
            We compare against the <em>final</em> ask rather than the original one because that is the
            price the winning buyer was actually bidding against. Sellers who reduce on the way to a sale
            are counted separately, as the share that cut before selling, so a reader can see both
            behaviours rather than have one hidden inside the other.
          </p>
          <p>
            The three outcomes — over, at, and under asking — are reported separately and sum to 100%.
            Selling at <em>exactly</em> the asking price is a real and distinct behaviour, around one sale
            in twenty, and folding it into &ldquo;under&rdquo; would overstate how often sellers concede.
          </p>
          <p>
            <strong>The rate alone can mislead, so the typical premium travels with it.</strong> A
            neighbourhood where 43% of homes sell over ask by a median of $12,000 is a very different
            market from one where 62% sell over ask by a median of $170,000, and the percentage on its own
            cannot tell them apart. Read the two columns together.
          </p>
          <p>
            Neighbourhoods appear once they have at least 30 closed sales in the trailing 12 months, and
            anything under 100 is flagged in amber and excluded from the default view. A share is noisier
            than a median at the same sample: the margin on an 18% rate is roughly ±7 points at 30 sales
            but ±4 at 100. The rankings — most competitive, cooling fastest — are held to 100 sales in
            both periods, because those are the most quotable and least robust cuts on the page.
          </p>
          <p>
            <strong>Year-over-year is reported in percentage points</strong>, not percent. A rate moving
            from 15.0% to 18.2% is <em>+3.2 points</em>; calling it &ldquo;+21%&rdquo; is the standard way
            this number gets mangled. It is left blank unless both periods have at least 100 sales.
          </p>
          <p>
            &ldquo;Houses&rdquo; means detached, semi-detached, townhouse, duplex and multiplex homes;
            &ldquo;Condos&rdquo; means condo apartments, condo townhouses and co-ops — the same split used
            on our rent tracker, so the two pages can be read together.
          </p>
          <p>
            We exclude sales where the closing price differs from the ask by more than 50% in either
            direction. Those are data-entry errors — a placeholder ask of $1, a price typed in
            thousands — rather than negotiation outcomes, and they would distort the count as well as the
            ratio.
          </p>
          <p>
            <strong>Who else measures this.</strong> Wahi has published a GTA overbid/underbid report
            monthly since 2022, and it is the established source for the question in the Toronto area. It
            works differently: it compares a neighbourhood&apos;s <em>median list price</em> against its{" "}
            <em>median sold price</em> to label the neighbourhood overbid or underbid. This page measures
            the share of <em>individual</em> homes that closed above <em>their own</em> ask. The two can
            disagree honestly — a neighbourhood whose medians sit below asking can still have a third of
            its homes selling over, because a median hides the spread. Ours also runs province-wide rather
            than GTA-only, which is where most of these neighbourhoods have no published figure at all.
          </p>
          <p>
            Two honest limits. Our feed is a large subset of the Ontario market rather than all of it, so
            we publish shares and medians — never counts of how many homes sold. And this page carries no
            days-on-market figure by design: <strong>speed of sale is covered on its own tracker</strong>{" "}
            using relist-adjusted True DOM, and publishing a second, differently-scoped &ldquo;how
            fast&rdquo; number here would put two answers to one question on the same site.
          </p>
        </>
      }
      faqs={[
        {
          q: "Does 'over asking' mean there was a bidding war?",
          a: "Usually, but not always — and we don't claim it. A sale above the final ask means at least one buyer paid more than the seller was publicly asking, which most often follows competing offers. Some listings are deliberately underpriced to invite that. We report the outcome, not the process, because the outcome is what the record actually shows.",
        },
        {
          q: "Why does this differ from a headline about the average sale price?",
          a: "They measure different things. Average or median sale price tells you what homes cost. This tells you how sale prices landed relative to what sellers asked — a market can have falling prices and a high over-ask rate at the same time if sellers are pricing conservatively.",
        },
        {
          q: "Why do some neighbourhoods show no year-over-year change?",
          a: "Because either the current or the prior 12-month window had fewer than 100 closed sales. A change in a rate is a difference between two rates, so it needs both bases to be solid; we leave it blank rather than publish something that reads more precisely than it is.",
        },
        {
          q: "Can I use these numbers?",
          a: "Yes — they are free to quote, chart and embed, with a credit and link to PureProperty.ca. Journalists can request a custom cut at /data/for-journalists.",
        },
      ]}
    >
      {/* OverAskingBoard reads the query string (?type/&q) so every cut is linkable, and
          useSearchParams must sit under a Suspense boundary or the page cannot prerender. */}
      <Suspense
        fallback={<div className="h-96 animate-pulse rounded-xl border border-border" aria-hidden />}
      >
        <OverAskingBoard rows={board.rows} summary={board.summary} />
      </Suspense>
    </TrackerShell>
  );
}
