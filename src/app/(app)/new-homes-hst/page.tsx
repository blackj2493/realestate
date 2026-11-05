/**
 * /new-homes-hst — "Ontario's HST cut on new homes: what it means for you" (2026-11-04).
 *
 * Landing page for the HST post (Reddit, social). The post links here, so this page answers
 * the reader's next question — "what does this mean for ME?" — instead of a plain listing
 * grid: a relief calculator, the numbers in plain words, city links, and a written
 * new-vs-resale comparison offer (a lead, same pipeline as the address-page offers).
 *
 * The numbers are AGGREGATES only (no listing, no individual sold price), fixed at the
 * analysis date. MLS figures: TRREB, agreements Apr-Oct 2025 vs Apr-Oct 2026. Pre-construction
 * figures: BILD / Altus Group monthly GTA releases. Update both together, with AS_OF.
 */

import type { Metadata } from "next";
import { ogImageUrl } from "@/lib/og/ogImageUrl";
import HstCalculator from "./HstCalculator";
import CityLinks from "./CityLinks";
import NewVsResaleCard from "./NewVsResaleCard";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");
const PATH = "/new-homes-hst";
const AS_OF = "November 2026";

const TITLE = "Ontario's HST Cut on New Homes: What It Means for You";
const DESCRIPTION =
  "How much HST you save on a new home in Ontario, what the cut did to new and nearly-new home sales, and where buyers now have room to negotiate.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: `${TITLE} | PureProperty`,
  description: DESCRIPTION,
  alternates: { canonical: `${SITE_URL}${PATH}` },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: `${SITE_URL}${PATH}`,
    siteName: "PureProperty",
    type: "article",
    images: [ogImageUrl({ eyebrow: "New homes", title: "The HST cut, 6 months in", subtitle: "What it means for buyers." })],
  },
};

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-2xl font-bold text-foreground">{value}</p>
      <p className="mt-1 text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

const th = "px-3 py-2 text-left font-medium text-muted-foreground";
const td = "px-3 py-2 text-foreground";

/** Next steps: the request card and the city links. */
function NextSteps({ follow }: { follow?: string }) {
  return (
    <>
      <CityLinks follow={follow} />
      <NewVsResaleCard />
    </>
  );
}

/**
 * A reader who arrives from the post (utm_source=reddit, or the post's campaign) has
 * already read the numbers, so the next steps come right after the calculator. A fresh
 * visitor reads the numbers first and finds the next steps at the end.
 */
export default async function NewHomesHstPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const follow = typeof sp.follow === "string" ? sp.follow : undefined;
  // ?follow= = back from sign-in after "Email me new listings": keep the card near the top.
  const fromPost = sp.utm_source === "reddit" || sp.utm_campaign === "hst-new-vs-resale" || !!sp.follow;
  return (
    <main className="min-h-app bg-background text-foreground">
      <article className="mx-auto max-w-3xl space-y-8 px-4 py-8">
        <header>
          <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">New homes · {AS_OF}</p>
          <h1 className="mt-1 text-2xl font-bold sm:text-3xl">{TITLE}</h1>
          <p className="mt-3 text-muted-foreground">
            Since April 1, 2026, most people who buy a new home in Ontario pay little or no HST. Here is how much you
            save, what changed in the market, and what to do about it.
          </p>
        </header>

        <HstCalculator />

        {fromPost && <NextSteps follow={follow} />}

        <section aria-labelledby="short-title">
          <h2 id="short-title" className="text-lg font-semibold">
            The short version
          </h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <Stat value="+58%" label="more new homes sold under $1M on the MLS (Apr-Oct, vs a year earlier)" />
            <Stat value="-13%" label="lower typical builder price for a new house (September, vs a year earlier)" />
            <Stat value="83%" label="of nearly-new resale homes sold below their first asking price" />
          </div>
        </section>

        <section aria-labelledby="pre-title" className="space-y-2">
          <h2 id="pre-title" className="text-lg font-semibold">
            New houses are up. New condos are down.
          </h2>
          <p className="text-muted-foreground">Pre-construction sales in the GTA, from BILD and Altus Group:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>From April to September, sales of new houses and townhouses were above their 10-year average every month.</li>
            <li>In September, only 129 new condos sold: the lowest September on record, and 40% fewer than a year earlier.</li>
            <li>
              The typical builder price for a new house was $1,246,764 in September, 13% lower than a year earlier.
              At that price, you save $130,000 of HST.
            </li>
          </ul>
        </section>

        <section aria-labelledby="mls-title" className="space-y-2">
          <h2 id="mls-title" className="text-lg font-semibold">
            Most of the jump is under $1M, where you save the most
          </h2>
          <p className="text-muted-foreground">Finished new homes sold on the TRREB MLS, April to October:</p>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className={th}>Price</th>
                  <th className={`${th} text-right`}>2025</th>
                  <th className={`${th} text-right`}>2026</th>
                  <th className={`${th} text-right`}>Change</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                <tr><td className={td}>Under $1M</td><td className={`${td} text-right`}>1,040</td><td className={`${td} text-right`}>1,646</td><td className={`${td} text-right font-semibold`}>+58%</td></tr>
                <tr><td className={td}>$1M to $1.5M</td><td className={`${td} text-right`}>265</td><td className={`${td} text-right`}>328</td><td className={`${td} text-right`}>+24%</td></tr>
                <tr><td className={td}>Over $1.5M</td><td className={`${td} text-right`}>142</td><td className={`${td} text-right`}>157</td><td className={`${td} text-right`}>+11%</td></tr>
              </tbody>
            </table>
          </div>
          <p className="text-sm text-muted-foreground">
            The jump started in April, the first month of the cut. From January to March, new-home sales were 10%
            lower than a year earlier. All MLS sales rose 16% over the same months.
          </p>
        </section>

        <section aria-labelledby="resale-title" className="space-y-2">
          <h2 id="resale-title" className="text-lg font-semibold">
            Nearly-new resale: fewer buyers, more room on price
          </h2>
          <p className="text-muted-foreground">Resale homes 0-5 years old, April to October 2026, on the TRREB MLS:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>8% fewer sold than a year earlier.</li>
            <li>83% sold for less than the first asking price.</li>
            <li>The typical home sold for 96.4% of the first asking price. On a $900,000 home, that is about $32,000 less.</li>
          </ul>
          <p className="text-sm text-muted-foreground">New homes sold for 98.5% of the first asking price. Builders give less room.</p>
        </section>

        <section aria-labelledby="do-title" className="space-y-2">
          <h2 id="do-title" className="text-lg font-semibold">
            What should you do?
          </h2>
          <ul className="list-disc space-y-2 pl-5">
            <li><strong>New house or townhouse:</strong> no HST under $1M, and builder prices are 13% lower. Sign before March 31, 2027.</li>
            <li><strong>New condo:</strong> builders sell very few. Ask for extras on top of the HST saving.</li>
            <li><strong>Resale home 0-5 years old:</strong> you have room to negotiate. Most sellers take less than their asking price.</li>
            <li><strong>Ask every builder:</strong> does the price include HST? Do you get the rebate, or does the builder?</li>
          </ul>
        </section>

        {!fromPost && <NextSteps follow={follow} />}

        <footer className="space-y-1 border-t border-border pt-4 text-xs text-muted-foreground">
          <p>
            Sources: BILD / Altus Group monthly GTA new-home sales reports (2026). TRREB MLS® System, sales agreed
            April-October 2025 and 2026; the analysis of the MLS data is ours. The MLS shows only finished new homes,
            not pre-construction sales. The timing fits the HST cut, but we cannot prove that it caused all of the change.
          </p>
          <p>Not tax advice. Figures as of {AS_OF}.</p>
        </footer>
      </article>
    </main>
  );
}
