/**
 * /data/rent-vs-buy/{city} — "Is it cheaper to rent or buy in {city}?" Typical rent against
 * the median sale price by bedroom count, the price-to-rent ratio and the city rank
 * (src/lib/data/rentVsBuy.ts). Gross figures: the page says it is not a personal verdict.
 *
 * Board cities read region_metrics (nightly); the extra study cities (London, Kitchener, ...)
 * read data/city-markets.json, built weekly with the same definitions. The rank covers every
 * covered city. Aggregate statistics only; hourly revalidate; unknown slugs 404.
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
import { boardRowFor, sourceLine } from "@/lib/data/cityFacts";
import { outlookCityBySlug } from "@/lib/data/outlookCities";
import { cityMarketBySlug, coveredMarketCities, coveredMarketRows, getCityMarkets, toMarketRow } from "@/lib/data/cityMarkets";
import { buildRentVsBuy, PTR_BUY, PTR_RENT, rentVsBuyPath, type RentBuyLean } from "@/lib/data/rentVsBuy";
import { titleYear } from "@/lib/seo/titleYear";
import { ogImageUrl } from "@/lib/og/ogImageUrl";
import { metaDescription } from "@/lib/seo/metaDescription";
import { DATA_PUBLISHER } from "@/lib/seo/publisher";

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
    const dataAsOf = extra ? getCityMarkets().generatedAt : board.dataAsOf;
    return { city, board: !extra, data: buildRentVsBuy(city, row, coveredMarketRows(board.rows), dataAsOf, titleYear()) };
  } catch (err) {
    console.error(`[rent-vs-buy] board read failed for ${slug}:`, err);
    return { city, board: !extra, data: null };
  }
}

const titleFor = (city: string) => `Is It Cheaper to Rent or Buy in ${city}? ${titleYear()} Rent vs Buy by Bedroom Count`;

export async function generateMetadata({ params }: { params: Promise<{ city: string }> }): Promise<Metadata> {
  const { city: slug } = await params;
  const loaded = await load(slug);
  if (!loaded) return {};
  const { city, data } = loaded;
  const canonical = `${SITE_URL}${rentVsBuyPath(slug)}`;
  const title = data?.title ?? titleFor(city);
  const description = data?.summary ?? `Typical rent against the median sale price in ${city}, by bedroom count, from MLS® data.`;
  return {
    metadataBase: new URL(SITE_URL),
    title: `${title} | PureProperty`,
    description: metaDescription(description),
    alternates: { canonical },
    openGraph: {
      title,
      description: metaDescription(description),
      url: canonical,
      siteName: "PureProperty",
      type: "article",
      images: [ogImageUrl({ eyebrow: "Rent vs buy", title: `Rent or buy in ${city}?`, subtitle: "Price-to-rent by bedroom count." })],
    },
  };
}

const LEAN_STYLE: Record<RentBuyLean, { text: string; cls: string }> = {
  buy: { text: "Favours buying", cls: "border-teal-600/40 bg-teal-600/10 text-teal-800 dark:text-teal-300" },
  rent: { text: "Favours renting", cls: "border-orange-600/40 bg-orange-600/10 text-orange-800 dark:text-orange-300" },
  neutral: { text: "Neither clearly", cls: "border-border bg-muted/40 text-muted-foreground" },
};
const TEAL = "#0d9488";
const money = (n: number) => `$${Math.round(n).toLocaleString("en-CA")}`;

export default async function RentVsBuyCityPage({ params }: { params: Promise<{ city: string }> }) {
  const { city: slug } = await params;
  const loaded = await load(slug);
  if (!loaded) notFound();
  const { city, board, data } = loaded;
  const canonical = `${SITE_URL}${rentVsBuyPath(slug)}`;
  const all = coveredMarketCities();
  const others = all.filter((c) => c.slug !== slug);
  const slugFor = (name: string) => all.find((c) => c.city.toLowerCase() === name.toLowerCase())?.slug ?? null;
  const title = data?.title ?? titleFor(city);
  const citation = data ? `PureProperty, "${data.title}", updated ${data.updatedLabel}, ${canonical.replace(/^https?:\/\/(www\.)?/, "")}` : "";
  const rankMax = data?.rank ? Math.max(...data.rank.cities.map((c) => c.ptr)) * 1.15 : 1;

  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
      { "@type": "ListItem", position: 2, name: "Data", item: `${SITE_URL}/data` },
      { "@type": "ListItem", position: 3, name: "Rent vs buy", item: `${SITE_URL}${rentVsBuyPath()}` },
      { "@type": "ListItem", position: 4, name: city, item: canonical },
    ],
  };
  const dataset = data
    ? {
        "@context": "https://schema.org",
        "@type": "Dataset",
        name: data.title,
        description: data.beds.map((b) => b.text).join(" "),
        url: canonical,
        dateModified: data.updatedIso,
        isAccessibleForFree: true,
        creator: DATA_PUBLISHER,
        publisher: DATA_PUBLISHER,
        spatialCoverage: { "@type": "Place", name: `${city}, Ontario, Canada` },
        measurementTechnique: sourceLine(!board),
        variableMeasured: data.beds.flatMap((b) => [
          { "@type": "PropertyValue", name: `Typical monthly rent, ${b.beds}-bedroom`, value: b.rent, unitText: "CAD" },
          { "@type": "PropertyValue", name: `Price-to-rent ratio, ${b.beds}-bedroom`, value: b.ptr, unitText: "ratio" },
        ]),
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
          <Link href={rentVsBuyPath()} className="hover:text-foreground">Rent vs buy</Link>
          <span className="mx-2">/</span>
          <span className="text-foreground">{city}</span>
        </nav>

        {!data ? (
          <>
            <h1 className="text-2xl font-bold sm:text-3xl">{title}</h1>
            <p className="mt-6 text-muted-foreground">
              The figures for {city} are not available right now. See <Link href={rentVsBuyPath()} className="underline">rent vs buy for all covered cities</Link>.
            </p>
          </>
        ) : (
          <>
            <HeaderCard
              Icon={Scale}
              eyebrow={`Rent vs buy · ${city}`}
              title={data.title}
              lede={
                <>
                  <p>{data.summary}</p>
                  <p className="mt-2 text-sm">
                    Updated <time dateTime={data.updatedIso}>{data.updatedLabel}</time> · MLS® rentals and sales, refreshed {board ? "nightly" : "weekly"}
                  </p>
                </>
              }
              hero={data.lead.ptr.toFixed(1)}
              heroSub={`price-to-rent ratio, ${data.lead.beds}-bedroom homes`}
              heroExtra={
                <p className="text-sm text-muted-foreground">
                  <span className="font-semibold text-foreground">{money(data.lead.price)}</span> to buy ·{" "}
                  <span className="font-semibold text-foreground">{money(data.lead.rent)}</span> a month to rent
                </p>
              }
            />

            <section className="mt-8 rounded-2xl border border-border bg-card/40 p-5 sm:p-6" aria-labelledby="beds">
              <h2 id="beds" className="text-lg font-semibold">Rent or buy in {city}, by bedroom count</h2>
              <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                {data.beds.map((b) => (
                  <li key={b.beds} className="rounded-xl border border-border bg-card/60 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium">{b.beds}-bedroom</p>
                      <span className={`rounded-full border px-2.5 py-0.5 text-xs ${LEAN_STYLE[b.lean].cls}`}>{LEAN_STYLE[b.lean].text}</span>
                    </div>
                    <p className="mt-1 text-2xl font-bold tabular-nums">{b.ptr.toFixed(1)}</p>
                    <p className="text-xs text-muted-foreground">times a year of rent</p>
                    <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
                      <div>
                        <dt className="text-xs text-muted-foreground">Rent</dt>
                        <dd className="tabular-nums">{money(b.rent)}/mo</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">Price</dt>
                        <dd className="tabular-nums">{money(b.price)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">Gross yield</dt>
                        <dd className="tabular-nums">{b.yieldPct.toFixed(1)}%</dd>
                      </div>
                    </dl>
                  </li>
                ))}
              </ul>
              <ul className="mt-5 space-y-2 text-sm leading-relaxed">
                {data.beds.map((b) => (
                  <li key={b.beds} className="flex gap-2">
                    <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-600 dark:bg-teal-400" />
                    <span>{b.text}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
                This page measures the market, not your situation. Whether to buy also depends on your down payment, mortgage rate and how long you plan to stay.
              </p>
            </section>

            {data.rank && (
              <section className="mt-8 rounded-2xl border border-border bg-card/40 p-5 sm:p-6" aria-labelledby="compare">
                <h2 id="compare" className="text-lg font-semibold">{city} against the other cities</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Price-to-rent ratio of 2-bedroom homes. Lowest (most favourable to buying) at the top.
                </p>
                <ul className="mt-5 space-y-2">
                  {data.rank.cities.map((c) => {
                    const me = c.city.toLowerCase() === city.toLowerCase();
                    const s = slugFor(c.city);
                    const w = (c.ptr / rankMax) * 100;
                    return (
                      <li key={c.city} className="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-3 sm:grid-cols-[9rem_minmax(0,1fr)]">
                        {s && !me ? (
                          <Link href={rentVsBuyPath(s)} className="truncate text-sm underline-offset-4 hover:underline">
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
                            <span className={`ml-1.5 text-xs tabular-nums ${me ? "font-semibold" : "text-muted-foreground"}`}>{c.ptr.toFixed(1)}</span>
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {data.rankText && <p className="mt-4 text-sm text-muted-foreground">{data.rankText}</p>}
              </section>
            )}

            <RequestCards city={city} citySlug={slug} />

            <div className="mx-auto max-w-3xl">
              <section className="mt-10" aria-labelledby="how">
                <h2 id="how" className="text-lg font-semibold">How we measure it</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  The typical rent comes from homes rented through MLS® in {city}, by bedroom count. The price is the median sale price of homes with the same number of bedrooms, last 12 months.
                  The price-to-rent ratio is the price divided by a year of rent: as a rule of thumb, under {PTR_BUY} tends to favour buying and over {PTR_RENT} tends to favour renting.
                  These are gross figures: they leave out mortgage interest, property tax, condo fees, insurance and upkeep, so they compare markets rather than give a personal answer.
                </p>
              </section>

              <div className="mt-8">
                <HubFaq faqs={data.faqs} heading={`Renting or buying in ${city}: common questions`} />
              </div>

              <CiteBox citation={citation} />
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{sourceLine(!board)}</p>
            </div>
          </>
        )}

        <div className="mx-auto max-w-3xl">
          <CityTopicLinks citySlug={slug} current="rent-vs-buy" />
          <section className="mt-8">
            <h2 className="text-sm font-semibold text-muted-foreground">Other cities</h2>
            <div className="mt-2 flex flex-wrap gap-2">
              {others.map((c) => (
                <Link
                  key={c.slug}
                  href={rentVsBuyPath(c.slug)}
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
