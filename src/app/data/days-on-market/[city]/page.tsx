/**
 * /data/days-on-market/{city} — "How long does it take to sell a house in {city}?" plus
 * "what is the best month to sell". Every sentence comes from buildSellingTime
 * (src/lib/data/sellingTime.ts); the FAQ answers and the Dataset JSON-LD reuse them.
 *
 * Layout (2026-11 design pass, same style as the Power of Sale Index): headline figure, stat
 * cards, the for-sale age bars, the city comparison, the month chart, request cards, method,
 * FAQ, cite box. Every figure is also in the HTML text.
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
import { Clock, Timer } from "lucide-react";
import HubFaq from "@/components/seo/HubFaq";
import { CiteBox, HeaderCard, RequestCards, StatCard } from "@/components/dataPage/parts";
import MonthColumns from "@/components/dataPage/MonthColumns";
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

const TEAL = "#0d9488";
const ORANGE = "#ea580c";

function Dot() {
  return <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-600 dark:bg-teal-400" />;
}

/** The two clocks for homes for sale now, as two short bars on one scale. */
function TwoClocks({ trueDom, boardDom }: { trueDom: number; boardDom: number }) {
  const max = Math.max(trueDom, boardDom, 1);
  const rows = [
    { label: "Listing counter", days: boardDom, teal: false },
    { label: "True time", days: trueDom, teal: true },
  ];
  return (
    <div className="space-y-1.5" aria-hidden="true">
      {rows.map((r) => (
        <div key={r.label} className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-2 text-[11px] text-muted-foreground">
          <span>{r.label}</span>
          <span className="flex items-center gap-1.5">
            <span
              className={`h-2 rounded-r-sm ${r.teal ? "" : "bg-muted-foreground/40"}`}
              style={{ width: `${(r.days / max) * 75}%`, ...(r.teal ? { background: TEAL } : {}) }}
            />
            <span className="tabular-nums text-foreground">{r.days}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

export default async function DaysOnMarketCityPage({ params }: { params: Promise<{ city: string }> }) {
  const { city: slug } = await params;
  const loaded = await load(slug);
  if (!loaded) notFound();
  const { city, data } = loaded;
  const canonical = `${SITE_URL}${daysOnMarketPath(slug)}`;
  const others = OUTLOOK_CITIES.filter((c) => c.slug !== slug);
  const slugFor = (name: string) => OUTLOOK_CITIES.find((c) => c.city.toLowerCase() === name.toLowerCase())?.slug ?? null;
  const st = data?.stats;
  const buckets = st?.buckets ?? null;
  const bucketMax = buckets ? Math.max(...buckets.map((b) => b.count), 1) : 1;
  const bucketTotal = buckets ? buckets.reduce((a, b) => a + b.count, 0) : 0;
  const rankMax = st?.rank ? Math.max(...st.rank.cities.map((c) => c.days)) * 1.15 : 1;
  const citation = data ? `PureProperty, "${data.title}", updated ${data.updatedLabel}, ${canonical.replace(/^https?:\/\/(www\.)?/, "")}` : "";

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
      <div className="mx-auto max-w-4xl px-4 py-8">
        <nav className="mb-5 text-sm text-muted-foreground">
          <Link href="/data" className="hover:text-foreground">Data</Link>
          <span className="mx-2">/</span>
          <Link href="/data/days-on-market" className="hover:text-foreground">Days on market</Link>
          <span className="mx-2">/</span>
          <span className="text-foreground">{city}</span>
        </nav>

        {!data || !st ? (
          <>
            <h1 className="text-2xl font-bold sm:text-3xl">How Long Does It Take to Sell a House in {city}?</h1>
            <p className="mt-6 text-muted-foreground">
              The figures for {city} are not available right now. See the{" "}
              <Link href="/data/days-on-market" className="underline">days on market for all covered cities</Link>.
            </p>
          </>
        ) : (
          <>
            <HeaderCard
              Icon={Timer}
              eyebrow={`Days on market · ${city}`}
              title={data.title}
              lede={
                <>
                  <p>{data.summary}</p>
                  <p className="mt-2 text-sm">
                    Updated <time dateTime={data.updatedIso}>{data.updatedLabel}</time> · MLS® sales and listings, refreshed nightly
                  </p>
                </>
              }
              hero={st.sold ? `${st.sold.median} days` : st.active ? `${st.active.trueDom} days` : null}
              heroSub={st.sold ? "median time to sell, last 12 months" : "median time on market, homes for sale now"}
              heroExtra={
                st.sold?.p25 != null && st.sold.p75 != null ? (
                  <p className="text-sm text-muted-foreground">
                    Half sold in <span className="font-semibold text-foreground">{st.sold.p25}–{st.sold.p75} days</span>
                  </p>
                ) : null
              }
            />

            <section className="mt-4 grid gap-3 sm:grid-cols-3" aria-label="Key figures">
              {st.active && (
                <StatCard
                  label="For sale now"
                  value={`${st.active.trueDom} days`}
                  sub={`Median true time on the market of the ${st.active.count.toLocaleString("en-CA")} homes for sale now.`}
                >
                  {st.active.boardDom != null && <TwoClocks trueDom={st.active.trueDom} boardDom={st.active.boardDom} />}
                </StatCard>
              )}
              {st.stale90Pct != null && <StatCard label="Listed over 90 days" value={`${st.stale90Pct}%`} sub={`Of the homes for sale in ${city} now.`} />}
              {st.rank ? (
                <StatCard label="Speed rank" value={`${st.rank.position} of ${st.rank.of}`} sub="Covered markets from fastest to slowest, by median time to sell." />
              ) : (
                st.peakRatio != null && <StatCard label="Busiest month" value={`${st.peakRatio}×`} sub="Sales in the busiest month against the quietest, last 2 years." />
              )}
            </section>

            <section className="mt-8 rounded-2xl border border-border bg-card/40 p-5 sm:p-6" aria-labelledby="shows">
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
                    <span>{data.rankText}</span>
                  </li>
                )}
              </ul>
            </section>

            {buckets && (
              <section className="mt-8 rounded-2xl border border-border bg-card/40 p-5 sm:p-6" aria-labelledby="age">
                <h2 id="age" className="text-lg font-semibold">How long the homes for sale now have been listed</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {bucketTotal.toLocaleString("en-CA")} homes for sale in {city}, relisted homes counted as one listing.
                </p>
                <ul className="mt-5 space-y-2.5">
                  {buckets.map((b, i) => {
                    const last = i === buckets.length - 1;
                    const share = bucketTotal ? Math.round((b.count / bucketTotal) * 100) : 0;
                    const w = (b.count / bucketMax) * 75;
                    return (
                      <li key={b.label} className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-3 text-sm">
                        <span className={last ? "font-medium" : "text-muted-foreground"}>{b.label}</span>
                        <span className="flex items-center gap-2">
                          <span
                            className="h-5 rounded-r-[4px]"
                            style={{ width: `${Math.max(1.5, w)}%`, background: last ? ORANGE : TEAL, opacity: last ? 0.9 : 0.75 }}
                            aria-hidden="true"
                          />
                          <span className="shrink-0 tabular-nums">
                            <span className="font-semibold">{share}%</span>
                            <span className="text-muted-foreground"> · {b.count.toLocaleString("en-CA")}</span>
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-4 text-xs text-muted-foreground">
                  A home listed for more than 90 days is often priced above what buyers will pay.{" "}
                  <Link href={`/house-not-selling/${slug}`} className="underline hover:text-foreground">
                    Why homes do not sell in {city}
                  </Link>
                  .
                </p>
              </section>
            )}

            {st.rank && (
              <section className="mt-8 rounded-2xl border border-border bg-card/40 p-5 sm:p-6" aria-labelledby="compare">
                <h2 id="compare" className="text-lg font-semibold">{city} against the other cities</h2>
                <p className="mt-1 text-sm text-muted-foreground">Median days to sell, homes sold in the last 12 months. Fastest at the top.</p>
                <ul className="mt-5 space-y-2">
                  {st.rank.cities.map((c) => {
                    const me = c.city.toLowerCase() === city.toLowerCase();
                    const s = slugFor(c.city);
                    const w = (c.days / rankMax) * 100;
                    return (
                      <li key={c.city} className="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-3 sm:grid-cols-[9rem_minmax(0,1fr)]">
                        {s && !me ? (
                          <Link href={daysOnMarketPath(s)} className="truncate text-sm underline-offset-4 hover:underline">
                            {c.city}
                          </Link>
                        ) : (
                          <span className={`truncate text-sm ${me ? "font-semibold" : ""}`}>{c.city}</span>
                        )}
                        <div className="relative h-5">
                          <div
                            className={`absolute inset-y-0.5 left-0 rounded-r-[4px] ${me ? "" : "bg-muted-foreground/30"}`}
                            style={{ width: `${Math.max(1.5, w)}%`, ...(me ? { background: TEAL } : {}) }}
                            aria-hidden="true"
                          />
                          <span className="absolute inset-y-0 flex items-center" style={{ left: `${Math.max(1.5, w)}%` }}>
                            <span className={`ml-1.5 text-xs tabular-nums ${me ? "font-semibold" : "text-muted-foreground"}`}>{c.days}</span>
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            {data.months && (
              <section className="mt-8 rounded-2xl border border-border bg-card/40 p-5 sm:p-6" aria-labelledby="months">
                <h2 id="months" className="text-lg font-semibold">The best month to sell in {city}: homes sold by month</h2>
                {data.seasonText && <p className="mt-1 text-sm text-muted-foreground">{data.seasonText}</p>}
                <div className="mt-4">
                  <MonthColumns months={data.months} ariaLabel={`Homes sold in ${city} by calendar month, last 2 years together`} />
                </div>
                <details className="mt-3 text-sm">
                  <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Show the numbers</summary>
                  <table className="mt-2 w-full max-w-sm text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-muted-foreground">
                        <th className="py-1.5 pr-3 font-medium">Month</th>
                        <th className="py-1.5 text-right font-medium">Homes sold, 2 years</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.months.map((m) => (
                        <tr key={m.month} className="border-b border-border/60">
                          <td className="py-1.5 pr-3">{m.label}</td>
                          <td className="py-1.5 text-right tabular-nums">{m.sales.toLocaleString("en-CA")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
                <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                  All home types, each calendar month counted over the last 2 years. The busiest months have the most buyers. This chart counts sales, not prices: the price of one home depends on the home and on the market at the time, not on the month alone.
                </p>
              </section>
            )}

            <RequestCards city={city} citySlug={slug} />

            <div className="mx-auto max-w-3xl">
              <section className="mt-10" aria-labelledby="how">
                <h2 id="how" className="flex items-center gap-2 text-lg font-semibold">
                  <Clock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  How we count days on market
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  When a home comes off the market and is listed again, the MLS® counter starts again at zero. PureProperty joins the listings of the same home into one when the gap between them is 35 days or less, so a home that was relisted keeps its full time on the market. Homes that sold and homes still for sale are measured separately: a slow market shows as a large gap between the two.
                </p>
              </section>

              <div className="mt-8">
                <HubFaq faqs={data.faqs} heading={`Selling a house in ${city}: common questions`} />
              </div>

              <CiteBox citation={citation} />
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{SOURCE_LINE}</p>
            </div>
          </>
        )}

        <div className="mx-auto max-w-3xl">
          <CityTopicLinks citySlug={slug} current="days-on-market" />

          <section className="mt-8">
            <h2 className="text-sm font-semibold text-muted-foreground">Other cities</h2>
            <div className="mt-2 flex flex-wrap gap-2">
              {others.map((c) => (
                <Link
                  key={c.slug}
                  href={daysOnMarketPath(c.slug)}
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
