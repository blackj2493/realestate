/**
 * /data/good-time-to-buy/{city} — "Is it a good time to buy a house in {city}?" The measured
 * buyer's-market signals (src/lib/data/goodTimeToBuy.ts), each with its figure and direction.
 * Claims the market only: the page says buying also depends on the reader's own money.
 *
 * Board figures refresh nightly (hourly revalidate, like /data/days-on-market); the price
 * signal comes from the monthly static price change file. The extra study cities (London,
 * Kitchener, ...) read data/city-markets.json, built weekly with the same definitions. The
 * cut and 90-day benchmarks are the medians of every covered city.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Scale } from "lucide-react";
import HubFaq from "@/components/seo/HubFaq";
import { CiteBox, HeaderCard, RequestCards } from "@/components/dataPage/parts";
import CityTopicLinks from "@/components/seo/CityTopicLinks";
import ListingComplianceNotice from "@/components/legal/ListingComplianceNotice";
import { getMarketBoard } from "@/lib/data/marketBoard";
import { SOURCE_LINE, boardRowFor } from "@/lib/data/cityFacts";
import { outlookCityBySlug } from "@/lib/data/outlookCities";
import { cityMarketBySlug, coveredMarketCities, coveredMarketRows, getCityMarkets, toMarketRow } from "@/lib/data/cityMarkets";
import { buildBuyVerdict, buyFaqs, goodTimeToBuyPath, type Lean } from "@/lib/data/goodTimeToBuy";
import { priceChangeAreaBySlug } from "@/lib/data/priceChange";
import { titleYear } from "@/lib/seo/titleYear";
import { ogImageUrl } from "@/lib/og/ogImageUrl";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");
export const revalidate = 3600;
export const dynamicParams = false;

export function generateStaticParams() {
  return coveredMarketCities().map((c) => ({ city: c.slug }));
}

async function load(slug: string) {
  const extra = outlookCityBySlug(slug) ? null : cityMarketBySlug(slug);
  const city = outlookCityBySlug(slug) ?? extra?.city;
  if (!city) return null;
  try {
    const board = await getMarketBoard();
    const row = extra ? toMarketRow(extra) : boardRowFor(board.rows, city);
    const verdict = row ? buildBuyVerdict(city, row, coveredMarketRows(board.rows), priceChangeAreaBySlug(slug)) : null;
    return { city, board: !extra, verdict, dataAsOf: extra ? getCityMarkets().generatedAt : board.dataAsOf };
  } catch (err) {
    console.error(`[good-time-to-buy] board read failed for ${slug}:`, err);
    return { city, board: !extra, verdict: null, dataAsOf: null };
  }
}

const titleFor = (city: string) => `Is It a Good Time to Buy a House in ${city}? ${titleYear()} Buyer's Market Signals`;

export async function generateMetadata({ params }: { params: Promise<{ city: string }> }): Promise<Metadata> {
  const { city: slug } = await params;
  const loaded = await load(slug);
  if (!loaded) return {};
  const { city, verdict } = loaded;
  const canonical = `${SITE_URL}${goodTimeToBuyPath(slug)}`;
  const title = titleFor(city);
  const description = verdict?.summary ?? `Measured buyer's and seller's market signals for ${city}, from MLS® data.`;
  return {
    metadataBase: new URL(SITE_URL),
    title: `${title} | PureProperty`,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      url: canonical,
      siteName: "PureProperty",
      type: "article",
      images: [ogImageUrl({ eyebrow: "Good time to buy?", title: `Is it a good time to buy in ${city}?`, subtitle: "Measured market signals." })],
    },
  };
}

const LEAN_STYLE: Record<Lean, { text: string; cls: string }> = {
  buyers: { text: "Favours buyers", cls: "border-teal-600/40 bg-teal-600/10 text-teal-800 dark:text-teal-300" },
  sellers: { text: "Favours sellers", cls: "border-orange-600/40 bg-orange-600/10 text-orange-800 dark:text-orange-300" },
  neutral: { text: "Neutral", cls: "border-border bg-muted/40 text-muted-foreground" },
};

export default async function GoodTimeToBuyCityPage({ params }: { params: Promise<{ city: string }> }) {
  const { city: slug } = await params;
  const loaded = await load(slug);
  if (!loaded) notFound();
  const { city, board, verdict, dataAsOf } = loaded;
  const year = titleYear();
  const title = titleFor(city);
  const canonical = `${SITE_URL}${goodTimeToBuyPath(slug)}`;
  const updatedIso = dataAsOf ? new Date(dataAsOf).toISOString() : null;
  const updatedLabel = dataAsOf ? new Date(dataAsOf).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric", timeZone: "America/Toronto" }) : null;
  const citation = `PureProperty, "${title}"${updatedLabel ? `, updated ${updatedLabel}` : ""}, ${canonical.replace(/^https?:\/\/(www\.)?/, "")}`;
  const faqs = verdict ? buyFaqs(city, verdict, year) : [];
  const others = coveredMarketCities().filter((c) => c.slug !== slug);

  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
      { "@type": "ListItem", position: 2, name: "Data", item: `${SITE_URL}/data` },
      { "@type": "ListItem", position: 3, name: "Good time to buy?", item: `${SITE_URL}${goodTimeToBuyPath()}` },
      { "@type": "ListItem", position: 4, name: city, item: canonical },
    ],
  };

  return (
    <main className="min-h-app bg-background text-foreground">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }} />
      <div className="mx-auto max-w-4xl px-4 py-8">
        <nav className="mb-5 text-sm text-muted-foreground">
          <Link href="/data" className="hover:text-foreground">Data</Link>
          <span className="mx-2">/</span>
          <Link href={goodTimeToBuyPath()} className="hover:text-foreground">Good time to buy?</Link>
          <span className="mx-2">/</span>
          <span className="text-foreground">{city}</span>
        </nav>

        {!verdict ? (
          <>
            <h1 className="text-2xl font-bold sm:text-3xl">{title}</h1>
            <p className="mt-6 text-muted-foreground">
              The figures for {city} are not available right now. See <Link href={goodTimeToBuyPath()} className="underline">all covered cities</Link>.
            </p>
          </>
        ) : (
          <>
            <HeaderCard
              Icon={Scale}
              eyebrow={`Good time to buy? · ${city}`}
              title={title}
              lede={
                <>
                  <p>{verdict.summary}</p>
                  {updatedIso && (
                    <p className="mt-2 text-sm">
                      Updated <time dateTime={updatedIso}>{updatedLabel}</time> · MLS® sales and listings, refreshed {board ? "nightly" : "weekly"}
                    </p>
                  )}
                </>
              }
              hero={`${verdict.forBuyers} of ${verdict.counted}`}
              heroSub="signals favour buyers"
            />

            <section className="mt-8 rounded-2xl border border-border bg-card/40 p-5 sm:p-6" aria-labelledby="signals">
              <h2 id="signals" className="text-lg font-semibold">The signals, {city}</h2>
              <ul className="mt-4 space-y-3">
                {verdict.signals.map((s) => (
                  <li key={s.id} className="rounded-xl border border-border bg-card/60 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium">{s.label}</p>
                      <span className={`rounded-full border px-2.5 py-0.5 text-xs ${LEAN_STYLE[s.lean].cls}`}>{LEAN_STYLE[s.lean].text}</span>
                    </div>
                    <p className="mt-1 text-2xl font-bold tabular-nums">{s.value}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{s.text}</p>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
                This page measures the market, not your situation. Whether to buy also depends on your income, savings, mortgage rate and how long
                you plan to stay.
              </p>
            </section>

            <RequestCards city={city} citySlug={slug} />

            <div className="mx-auto max-w-3xl">
              <section className="mt-10" aria-labelledby="how">
                <h2 id="how" className="text-lg font-semibold">How we measure it</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  Market temperature uses the same rule as every PureProperty market page: the sale-to-list ratio first, then months of supply.
                  The price signal compares the same kind of home with a year earlier (<Link href={`/data/price-change/${slug}`} className="underline">price change in {city}</Link>).
                  Price cuts and listings older than 90 days are compared with the median of the covered cities, so a city counts as
                  favouring buyers only when it is at least 10% above that median.
                </p>
              </section>

              <div className="mt-8">
                <HubFaq faqs={faqs} heading={`Buying in ${city}: common questions`} />
              </div>

              <CiteBox citation={citation} />
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{SOURCE_LINE}</p>
            </div>
          </>
        )}

        <div className="mx-auto max-w-3xl">
          <CityTopicLinks citySlug={slug} current="good-time-to-buy" />
          <section className="mt-8">
            <h2 className="text-sm font-semibold text-muted-foreground">Other cities</h2>
            <div className="mt-2 flex flex-wrap gap-2">
              {others.map((c) => (
                <Link
                  key={c.slug}
                  href={goodTimeToBuyPath(c.slug)}
                  className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
                >
                  {c.city}
                </Link>
              ))}
            </div>
          </section>
          <div className="mt-8">
            <ListingComplianceNotice />
          </div>
        </div>
      </div>
    </main>
  );
}
