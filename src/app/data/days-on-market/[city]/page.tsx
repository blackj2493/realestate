/**
 * /data/days-on-market/{city} — "How long does it take to sell a house in {city}?" plus
 * "what is the best month to sell". Every sentence comes from buildSellingTime
 * (src/lib/data/sellingTime.ts); the FAQ answers and the Dataset JSON-LD reuse them.
 *
 * Aggregate statistics only (the public market board), same category as the /data
 * trackers. Static per covered city, hourly revalidate; unknown slugs 404.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getMarketBoard } from "@/lib/data/marketBoard";
import { boardRowFor, SOURCE_LINE } from "@/lib/data/cityFacts";
import { buildSellingTime } from "@/lib/data/sellingTime";
import { OUTLOOK_CITIES, outlookCityBySlug } from "@/lib/data/outlookCities";
import { daysOnMarketPath } from "@/lib/seo/cityTopics";
import HubFaq from "@/components/seo/HubFaq";
import CityTopicLinks from "@/components/seo/CityTopicLinks";
import ListingComplianceNotice from "@/components/legal/ListingComplianceNotice";
import { ogImageUrl } from "@/lib/og/ogImageUrl";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");
export const revalidate = 3600;
export const dynamicParams = false;

export function generateStaticParams() {
  return OUTLOOK_CITIES.map((c) => ({ city: c.slug }));
}

async function load(slug: string) {
  const city = outlookCityBySlug(slug);
  if (!city) return null;
  try {
    const board = await getMarketBoard();
    return { city, data: buildSellingTime(city, boardRowFor(board.rows, city), board.rows, board.dataAsOf) };
  } catch (err) {
    console.error(`[days-on-market] board read failed for ${slug}:`, err);
    return { city, data: null };
  }
}

export async function generateMetadata({ params }: { params: Promise<{ city: string }> }): Promise<Metadata> {
  const { city: slug } = await params;
  const loaded = await load(slug);
  if (!loaded) return {};
  const { city, data } = loaded;
  const canonical = `${SITE_URL}${daysOnMarketPath(slug)}`;
  const title = data?.title ?? `How Long Does It Take to Sell a House in ${city}?`;
  const description = data?.summary ?? `Days on market and the busiest months for home sales in ${city}, from MLS® data, updated nightly.`;
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
      images: [ogImageUrl({ eyebrow: "Days on market", title: `How long homes take to sell in ${city}`, subtitle: "Relists counted as one listing." })],
    },
  };
}

const Dot = () => <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-600 dark:bg-emerald-400" />;

export default async function DaysOnMarketCityPage({ params }: { params: Promise<{ city: string }> }) {
  const { city: slug } = await params;
  const loaded = await load(slug);
  if (!loaded) notFound();
  const { city, data } = loaded;
  const canonical = `${SITE_URL}${daysOnMarketPath(slug)}`;
  const others = OUTLOOK_CITIES.filter((c) => c.slug !== slug);
  const maxSales = data?.months ? Math.max(...data.months.map((m) => m.sales)) : 0;

  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
      { "@type": "ListItem", position: 2, name: "Data", item: `${SITE_URL}/data` },
      { "@type": "ListItem", position: 3, name: "Days on market", item: `${SITE_URL}/data/days-on-market` },
      { "@type": "ListItem", position: 4, name: city, item: canonical },
    ],
  };
  const dataset = data
    ? {
        "@context": "https://schema.org",
        "@type": "Dataset",
        name: data.title,
        description: data.facts.map((f) => f.text).join(" "),
        url: canonical,
        dateModified: data.updatedIso,
        isAccessibleForFree: true,
        creator: { "@type": "Organization", name: "PureProperty", url: "https://www.pureproperty.ca" },
        spatialCoverage: { "@type": "Place", name: `${city}, Ontario, Canada` },
        measurementTechnique: SOURCE_LINE,
        variableMeasured: data.facts.map((f) => ({ "@type": "PropertyValue", ...f.measure })),
      }
    : null;

  return (
    <main className="min-h-app bg-background text-foreground">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }} />
      {dataset && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(dataset) }} />}
      <div className="mx-auto max-w-3xl px-4 py-8">
        <nav className="mb-4 text-sm text-muted-foreground">
          <Link href="/data" className="hover:text-foreground">Data</Link>
          <span className="mx-2">/</span>
          <Link href="/data/days-on-market" className="hover:text-foreground">Days on market</Link>
          <span className="mx-2">/</span>
          <span className="text-foreground">{city}</span>
        </nav>

        <h1 className="text-2xl font-bold sm:text-3xl">{data?.title ?? `How Long Does It Take to Sell a House in ${city}?`}</h1>
        {data && (
          <p className="mt-1 text-sm text-muted-foreground">
            Updated <time dateTime={data.updatedIso}>{data.updatedLabel}</time> · MLS® sales and listings, refreshed nightly
          </p>
        )}

        {!data ? (
          <p className="mt-6 text-muted-foreground">
            The figures for {city} are not available right now. See the{" "}
            <Link href="/data/days-on-market" className="underline">days on market for all covered cities</Link>.
          </p>
        ) : (
          <>
            <section className="mt-6" aria-labelledby="shows">
              <h2 id="shows" className="text-lg font-semibold">What the data shows</h2>
              <ul className="mt-3 space-y-2 text-sm leading-relaxed">
                {data.facts.map((f) => (
                  <li key={f.id} className="flex gap-2">
                    <Dot />
                    <span>{f.text}</span>
                  </li>
                ))}
                {data.rankText && (
                  <li className="flex gap-2">
                    <Dot />
                    <span>
                      {data.rankText}{" "}
                      <Link href="/data/days-on-market" className="underline hover:text-foreground">All cities</Link>.
                    </span>
                  </li>
                )}
              </ul>
            </section>

            {data.months && (
              <section className="mt-8" aria-labelledby="months">
                <h2 id="months" className="text-lg font-semibold">The best month to sell in {city}: sales by month</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  Number of homes sold in each calendar month, all home types, last 2 years together.
                </p>
                <ul className="mt-4 space-y-1.5 text-sm" aria-label={`Homes sold in ${city} by calendar month, last 2 years`}>
                  {data.months.map((m) => (
                    <li key={m.month} className="grid grid-cols-[5.5rem_minmax(0,1fr)_3.5rem] items-center gap-2">
                      <span className="text-muted-foreground">{m.label}</span>
                      <span className="h-3 rounded-r-sm bg-emerald-600/85 dark:bg-emerald-400/85" style={{ width: `${Math.max(2, (m.sales / maxSales) * 100)}%` }} aria-hidden="true" />
                      <span className="text-right tabular-nums">{m.sales.toLocaleString("en-CA")}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                  The busiest months have the most buyers. This chart counts sales, not prices: the price of one home depends on the home and on the market at the time, not on the month alone.
                </p>
              </section>
            )}

            <section className="mt-8" aria-labelledby="how">
              <h2 id="how" className="text-lg font-semibold">How we count days on market</h2>
              <p className="mt-2 text-sm leading-relaxed">
                When a home comes off the market and is listed again, the MLS® counter starts again at zero. PureProperty joins the listings of the same home into one when the gap between them is 35 days or less, so a home that was relisted keeps its full time on the market. Homes that sold and homes still for sale are measured separately: a slow market shows as a large gap between the two.
              </p>
            </section>

            <div className="mt-8">
              <HubFaq faqs={data.faqs} heading={`Selling a house in ${city}: common questions`} />
            </div>

            <p className="mt-6 text-xs leading-relaxed text-muted-foreground">{SOURCE_LINE}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Cite as: PureProperty, &ldquo;{data.title}&rdquo;, updated {data.updatedLabel}, {canonical.replace(/^https?:\/\/(www\.)?/, "")}
            </p>
          </>
        )}

        <CityTopicLinks citySlug={slug} current="days-on-market" />

        <section className="mt-8">
          <h2 className="text-sm font-semibold text-muted-foreground">Other cities</h2>
          <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm">
            {others.map((c) => (
              <Link key={c.slug} href={daysOnMarketPath(c.slug)} className="underline hover:text-foreground">
                {c.city}
              </Link>
            ))}
          </p>
        </section>

        <div className="mt-8">
          <ListingComplianceNotice />
        </div>
      </div>
    </main>
  );
}
