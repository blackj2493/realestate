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
import { BarChart3, LineChart } from "lucide-react";
import { Change, CiteBox, HeaderCard, LinkCard, PriceOpinionCard, StatCard } from "@/components/dataPage/parts";
import { daysOnMarketPath } from "@/lib/seo/cityTopics";
import CityTopicLinks from "@/components/seo/CityTopicLinks";
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

function Dot() {
  return <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-600 dark:bg-teal-400" />;
}

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-CA")}`;
const num = (n: number) => Math.round(n).toLocaleString("en-CA");
const pct1 = (n: number) => `${n.toFixed(1)}%`;

export default async function HousingMarketCityPage({ params }: { params: Promise<{ city: string }> }) {
  const { city: slug } = await params;
  const data = await load(slug);
  if (!data) notFound();
  const { city, outlook } = data;
  const canonical = `${SITE_URL}${outlookPath(slug)}`;
  const hub = `/property/on/${slug}`;
  const others = OUTLOOK_CITIES.filter((c) => c.slug !== slug);
  const st = outlook?.stats;
  const citation = outlook ? `PureProperty, "${outlook.title}", updated ${outlook.updatedLabel}, ${canonical.replace(/^https?:\/\/(www\.)?/, "")}` : "";

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
      <div className="mx-auto max-w-4xl px-4 py-8">
        <nav className="mb-5 text-sm text-muted-foreground">
          <Link href="/data" className="hover:text-foreground">Data</Link>
          <span className="mx-2">/</span>
          <Link href="/data/housing-market" className="hover:text-foreground">Housing market</Link>
          <span className="mx-2">/</span>
          <span className="text-foreground">{city}</span>
        </nav>

        {!outlook || !st ? (
          <>
            <h1 className="text-2xl font-bold sm:text-3xl">{city} Housing Market</h1>
            <p className="mt-6 text-muted-foreground">
              The figures for {city} are not available right now. See{" "}
              <Link href={hub} className="underline">homes for sale in {city}</Link>.
            </p>
          </>
        ) : (
          <>
            <HeaderCard
              Icon={LineChart}
              eyebrow={`Housing market · ${city}${outlook.marketType ? ` · ${outlook.marketType}` : ""}`}
              title={outlook.title}
              lede={
                <>
                  <p>{outlook.summary}</p>
                  <p className="mt-2 text-sm">
                    Updated <time dateTime={outlook.updatedIso}>{outlook.updatedLabel}</time> · MLS® sales and listings, refreshed nightly. PureProperty does not forecast prices: this page shows the measures that forecasts are built from.
                  </p>
                </>
              }
              hero={st.price ? usd(st.price.now) : null}
              heroSub={st.span ? `median sale price, ${st.span}` : undefined}
              heroExtra={st.price ? <Change now={st.price.now} before={st.price.before} fmt={usd} /> : null}
            />

            <section className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Key figures">
              {st.sales && (
                <StatCard label="Homes sold" value={num(st.sales.now)} sub={st.span ? `${st.span}, all home types.` : "Last 3 months."}>
                  <Change now={st.sales.now} before={st.sales.before} fmt={num} />
                </StatCard>
              )}
              {st.s2l && (
                <StatCard label="Sale to asking price" value={pct1(st.s2l.now)} sub="Average share of the final asking price, last 3 months.">
                  <Change now={st.s2l.now} before={st.s2l.before} fmt={pct1} mode="pts" />
                </StatCard>
              )}
              {st.underAskPct != null && (
                <StatCard label="Sold below first ask" value={`${st.underAskPct}%`} sub="Of the homes sold in the last 12 months." />
              )}
              {st.cutPct != null ? (
                <StatCard
                  label="Price cuts"
                  value={`${st.cutPct}%`}
                  sub={`Of the homes for sale now have cut their price${st.medianCutPct != null ? `; median cut ${pct1(st.medianCutPct)}` : ""}.`}
                />
              ) : (
                st.fromHighPct != null && (
                  <StatCard label="From the 2-year high" value={st.fromHighPct >= 0 ? "At the high" : pct1(st.fromHighPct)} sub="3-month median sale price against its highest level." />
                )
              )}
            </section>

            <section className="mt-8 rounded-2xl border border-border bg-card/40 p-5 sm:p-6" aria-labelledby="shows">
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
              <section className="mt-8 rounded-2xl border border-border bg-card/40 p-5 sm:p-6" aria-labelledby="monthly">
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
              <section className="mt-8 rounded-2xl border border-border bg-card/40 p-5 sm:p-6" aria-labelledby="season">
                <h2 id="season" className="text-lg font-semibold">When homes sell in {city}</h2>
                <p className="mt-2 text-sm leading-relaxed">{outlook.seasonText}</p>
                <p className="mt-2 text-sm">
                  <Link href={daysOnMarketPath(slug)} className="underline hover:text-foreground">
                    Sales by month and how long homes take to sell in {city} →
                  </Link>
                </p>
              </section>
            )}

            <section className="mt-8 grid gap-3 sm:grid-cols-2">
              {/* The public page is the front door; the full terminal (filters by home type, beds and
                  price band, inventory, rental yield) is VOW-gated behind a free account. */}
              <LinkCard
                href={`/analytics?region=${encodeURIComponent(city)}`}
                Icon={BarChart3}
                title={`The full ${city} market data`}
                text="Free account: filter by home type, bedrooms and price, and see inventory and rents."
              />
              <PriceOpinionCard citySlug={slug} />
            </section>
            <p className="mt-3 text-sm text-muted-foreground">
              <Link href={`${hub}#market-facts`} className="underline hover:text-foreground">{city} market facts and homes for sale</Link>, with a page for each neighbourhood ·{" "}
              <Link href="/data/over-asking" className="underline hover:text-foreground">Sold over asking</Link> ·{" "}
              <Link href="/data/price-cuts" className="underline hover:text-foreground">Price cuts</Link>
            </p>

            <div className="mx-auto max-w-3xl">
              <div className="mt-10">
                <HubFaq faqs={outlook.faqs} heading={`${city} housing market: common questions`} />
              </div>
              <CiteBox citation={citation} />
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{SOURCE_LINE}</p>
            </div>
          </>
        )}

        <div className="mx-auto max-w-3xl">
          <CityTopicLinks citySlug={slug} current="market" showCityHub={false} />

          <section className="mt-8">
            <h2 className="text-sm font-semibold text-muted-foreground">Other cities</h2>
            <div className="mt-2 flex flex-wrap gap-2">
              {others.map((c) => (
                <Link
                  key={c.slug}
                  href={outlookPath(c.slug)}
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
