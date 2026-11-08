/**
 * /data/housing-market/{city} — "{City} Housing Market {year}: What the Data Shows Now".
 *
 * Answers the most-searched housing question in every board city (forecast / crash /
 * good time to buy or sell) with measured indicators only — PureProperty does not
 * forecast prices. Every sentence comes from buildOutlook (src/lib/data/marketOutlook.ts);
 * the FAQ answers and the Dataset JSON-LD reuse the same sentences.
 *
 * Aggregate statistics only (the public market board), same category as the /data
 * trackers. Static per city, hourly revalidate; unknown slugs 404.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getMarketBoard } from "@/lib/data/marketBoard";
import { boardRowFor, SOURCE_LINE } from "@/lib/data/cityFacts";
import { buildOutlook } from "@/lib/data/marketOutlook";
import { OUTLOOK_CITIES, outlookCityBySlug, outlookPath } from "@/lib/data/outlookCities";
import HubFaq from "@/components/seo/HubFaq";
import MonthlyMarketCharts from "@/components/data/MonthlyMarketCharts";
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
    return { city, outlook: buildOutlook(city, boardRowFor(board.rows, city), board.dataAsOf) };
  } catch (err) {
    console.error(`[housing-market] board read failed for ${slug}:`, err);
    return { city, outlook: null };
  }
}

export async function generateMetadata({ params }: { params: Promise<{ city: string }> }): Promise<Metadata> {
  const { city: slug } = await params;
  const data = await load(slug);
  if (!data) return {};
  const { city, outlook } = data;
  const canonical = `${SITE_URL}${outlookPath(slug)}`;
  const title = outlook?.title ?? `${city} Housing Market: What the Data Shows Now`;
  const description = outlook?.summary ?? `Sale prices, sales and price cuts in ${city}, from MLS® data, updated nightly.`;
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
      images: [ogImageUrl({ eyebrow: "Housing market", title: `${city} housing market`, subtitle: "What the data shows now. No forecasts." })],
    },
  };
}

const Dot = () => <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-600 dark:bg-emerald-400" />;

export default async function HousingMarketCityPage({ params }: { params: Promise<{ city: string }> }) {
  const { city: slug } = await params;
  const data = await load(slug);
  if (!data) notFound();
  const { city, outlook } = data;
  const canonical = `${SITE_URL}${outlookPath(slug)}`;
  const hub = `/property/on/${slug}`;
  const others = OUTLOOK_CITIES.filter((c) => c.slug !== slug);

  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
      { "@type": "ListItem", position: 2, name: "Data", item: `${SITE_URL}/data` },
      { "@type": "ListItem", position: 3, name: "Housing market", item: `${SITE_URL}/data/housing-market` },
      { "@type": "ListItem", position: 4, name: city, item: canonical },
    ],
  };
  const dataset = outlook
    ? {
        "@context": "https://schema.org",
        "@type": "Dataset",
        name: outlook.title,
        description: outlook.facts.map((f) => f.text).join(" "),
        url: canonical,
        dateModified: outlook.updatedIso,
        isAccessibleForFree: true,
        creator: { "@type": "Organization", name: "PureProperty", url: "https://www.pureproperty.ca" },
        spatialCoverage: { "@type": "Place", name: `${city}, Ontario, Canada` },
        measurementTechnique: SOURCE_LINE,
        variableMeasured: outlook.facts.map((f) => ({ "@type": "PropertyValue", ...f.measure })),
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
          <Link href="/data/housing-market" className="hover:text-foreground">Housing market</Link>
          <span className="mx-2">/</span>
          <span className="text-foreground">{city}</span>
        </nav>

        <h1 className="text-2xl font-bold sm:text-3xl">{outlook?.title ?? `${city} Housing Market`}</h1>
        {outlook && (
          <p className="mt-1 text-sm text-muted-foreground">
            Updated <time dateTime={outlook.updatedIso}>{outlook.updatedLabel}</time> · MLS® sales and listings, refreshed nightly
          </p>
        )}

        {!outlook ? (
          <p className="mt-6 text-muted-foreground">
            The figures for {city} are not available right now. See{" "}
            <Link href={hub} className="underline">homes for sale in {city}</Link>.
          </p>
        ) : (
          <>
            <p className="mt-5 text-base leading-relaxed">{outlook.summary}</p>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              PureProperty does not forecast prices. This page shows the measures that forecasts are built from, for {city}, as they stand now.
            </p>

            <section className="mt-8" aria-labelledby="shows">
              <h2 id="shows" className="text-lg font-semibold">What the data shows</h2>
              <ul className="mt-3 space-y-2 text-sm leading-relaxed">
                {outlook.facts.map((f) => (
                  <li key={f.id} className="flex gap-2">
                    <Dot />
                    <span>{f.text}</span>
                  </li>
                ))}
                {outlook.typeText && (
                  <li className="flex gap-2">
                    <Dot />
                    <span>
                      {outlook.typeText}{" "}
                      <Link href="/data/market-temperature" className="underline hover:text-foreground">How we rate markets</Link>.
                    </span>
                  </li>
                )}
              </ul>
            </section>

            <MonthlyMarketCharts city={city} points={outlook.series} />

            {outlook.table.length > 0 && (
              <section className="mt-8" aria-labelledby="monthly">
                <h2 id="monthly" className="text-lg font-semibold">Month by month, last 12 months</h2>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[420px] text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-muted-foreground">
                        <th className="py-2 pr-3 font-medium">Month</th>
                        <th className="py-2 pr-3 text-right font-medium">Median sale price</th>
                        <th className="py-2 pr-3 text-right font-medium">Sales</th>
                        <th className="py-2 text-right font-medium">Sale to final asking</th>
                      </tr>
                    </thead>
                    <tbody>
                      {outlook.table.map((r) => (
                        <tr key={r.month} className="border-b border-border/60">
                          <td className="py-2 pr-3">{r.label}</td>
                          <td className="py-2 pr-3 text-right tabular-nums">${r.medianPrice.toLocaleString("en-CA")}</td>
                          <td className="py-2 pr-3 text-right tabular-nums">{r.sales.toLocaleString("en-CA")}</td>
                          <td className="py-2 text-right tabular-nums">{r.soldToList != null ? `${r.soldToList.toFixed(1)}%` : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">All home types. A month&apos;s median moves with the mix of homes that sold in it.</p>
              </section>
            )}

            {outlook.seasonText && (
              <section className="mt-8" aria-labelledby="season">
                <h2 id="season" className="text-lg font-semibold">When homes sell in {city}</h2>
                <p className="mt-3 text-sm leading-relaxed">{outlook.seasonText}</p>
              </section>
            )}

            <section className="mt-8 rounded-lg border border-border bg-card/40 p-5">
              <h2 className="text-base font-semibold">More on {city}</h2>
              <ul className="mt-2 space-y-1 text-sm">
                <li>
                  {/* The public page is the front door; the full terminal (filters by home type,
                      beds and price band, inventory, rental yield) is VOW-gated behind a free account. */}
                  <Link href={`/analytics?region=${encodeURIComponent(city)}`} className="font-medium underline">
                    See the full {city} market data
                  </Link>{" "}
                  (free account): filter by home type, bedrooms and price, and see inventory and rents
                </li>
                <li>
                  <Link href={`${hub}#market-facts`} className="underline">{city} market facts and homes for sale</Link>, with a page for each neighbourhood
                </li>
                <li>
                  <Link href="/data/over-asking" className="underline">Sold over asking</Link> ·{" "}
                  <Link href="/data/price-cuts" className="underline">Price cuts</Link> ·{" "}
                  <Link href="/data/days-on-market" className="underline">Days on market</Link>
                </li>
              </ul>
            </section>

            <div className="mt-8">
              <HubFaq faqs={outlook.faqs} heading={`${city} housing market: common questions`} />
            </div>

            <p className="mt-6 text-xs leading-relaxed text-muted-foreground">{SOURCE_LINE}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Cite as: PureProperty, &ldquo;{outlook.title}&rdquo;, updated {outlook.updatedLabel}, {canonical.replace(/^https?:\/\/(www\.)?/, "")}
            </p>
          </>
        )}

        <section className="mt-8">
          <h2 className="text-sm font-semibold text-muted-foreground">Other cities</h2>
          <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm">
            {others.map((c) => (
              <Link key={c.slug} href={outlookPath(c.slug)} className="underline hover:text-foreground">{c.city}</Link>
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
