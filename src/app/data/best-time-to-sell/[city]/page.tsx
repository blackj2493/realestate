/**
 * /data/best-time-to-sell/{city} — "Best time to sell a house in {city} {year}": by the month
 * the deal was signed, the price against similar homes in the average month, days on market,
 * sale-to-asking and the share over asking; and by the weekday the home was listed. Every
 * sentence comes from buildBestTimeFacts.
 *
 * Fully static from data/best-time-to-sell.json (rebuilt monthly by refresh-best-time-to-sell.yml).
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarClock } from "lucide-react";
import HubFaq from "@/components/seo/HubFaq";
import { CiteBox, HeaderCard, RequestCards, StatCard } from "@/components/dataPage/parts";
import MonthPriceTable from "@/components/bestTimeToSell/MonthPriceTable";
import CityTopicLinks from "@/components/seo/CityTopicLinks";
import {
  BEST_TIME_SOURCE_LINE,
  MONTH_NAMES,
  WEEKDAY_NAMES,
  bestMonths,
  bestTimeCityBySlug,
  bestTimeToSellPath,
  buildBestTimeFacts,
  getBestTimeData,
  signedPct,
  worstMonths,
} from "@/lib/data/bestTimeToSell";
import { titleYear } from "@/lib/seo/titleYear";
import { ogImageUrl } from "@/lib/og/ogImageUrl";
import { metaDescription } from "@/lib/seo/metaDescription";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");
export const dynamicParams = false;

export function generateStaticParams() {
  return getBestTimeData().cities.map((c) => ({ city: c.slug }));
}

function load(slug: string) {
  const c = bestTimeCityBySlug(slug);
  if (!c) return null;
  const file = getBestTimeData();
  return { c, file, facts: buildBestTimeFacts(c, file, titleYear()) };
}

export async function generateMetadata({ params }: { params: Promise<{ city: string }> }): Promise<Metadata> {
  const { city: slug } = await params;
  const loaded = load(slug);
  if (!loaded) return {};
  const { c, facts } = loaded;
  const canonical = `${SITE_URL}${bestTimeToSellPath(c.slug)}`;
  return {
    metadataBase: new URL(SITE_URL),
    title: `${facts.title} | PureProperty`,
    description: metaDescription(facts.summary),
    alternates: { canonical },
    openGraph: {
      title: facts.title,
      description: metaDescription(facts.summary),
      url: canonical,
      siteName: "PureProperty",
      type: "article",
      images: [ogImageUrl({ eyebrow: "Best time to sell", title: `Best time to sell in ${c.city}`, subtitle: "Price, speed and over-asking by month." })],
    },
  };
}

function Dot() {
  return <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-600 dark:bg-teal-400" />;
}

export default async function BestTimeCityPage({ params }: { params: Promise<{ city: string }> }) {
  const { city: slug } = await params;
  const loaded = load(slug);
  if (!loaded) notFound();
  const { c, file, facts } = loaded;
  const best = bestMonths(c);
  const worst = worstMonths(c);
  const fastest = [...c.months].filter((m) => m.medianDom != null).sort((a, b) => a.medianDom! - b.medianDom!)[0];
  const canonical = `${SITE_URL}${bestTimeToSellPath(c.slug)}`;
  const updatedIso = file.generatedAt.slice(0, 10);
  const updatedLabel = new Date(file.generatedAt).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric", timeZone: "America/Toronto" });
  const citation = `PureProperty, "${facts.title}", updated ${updatedLabel}, ${canonical.replace(/^https?:\/\/(www\.)?/, "")}`;
  const others = getBestTimeData().cities.filter((x) => x.slug !== c.slug);

  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
      { "@type": "ListItem", position: 2, name: "Data", item: `${SITE_URL}/data` },
      { "@type": "ListItem", position: 3, name: "Best time to sell", item: `${SITE_URL}${bestTimeToSellPath()}` },
      { "@type": "ListItem", position: 4, name: c.city, item: canonical },
    ],
  };
  const dataset = {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: facts.title,
    description: facts.facts.map((f) => f.text).join(" "),
    url: canonical,
    dateModified: updatedIso,
    temporalCoverage: `${file.from}/${file.to}`,
    isAccessibleForFree: true,
    creator: { "@type": "Organization", name: "PureProperty", url: "https://www.pureproperty.ca" },
    spatialCoverage: { "@type": "Place", name: `${c.city}, Ontario, Canada` },
    measurementTechnique: BEST_TIME_SOURCE_LINE,
    variableMeasured: c.months
      .filter((m) => m.price)
      .map((m) => ({ "@type": "PropertyValue", name: `Price against the average month, ${MONTH_NAMES[m.month - 1]}`, value: m.price!.pct, unitText: "percent" })),
  };

  return (
    <main className="min-h-app bg-background text-foreground">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(dataset) }} />
      <div className="mx-auto max-w-4xl px-4 py-8">
        <nav className="mb-5 text-sm text-muted-foreground">
          <Link href="/data" className="hover:text-foreground">Data</Link>
          <span className="mx-2">/</span>
          <Link href={bestTimeToSellPath()} className="hover:text-foreground">Best time to sell</Link>
          <span className="mx-2">/</span>
          <span className="text-foreground">{c.city}</span>
        </nav>

        <HeaderCard
          Icon={CalendarClock}
          eyebrow={`Best time to sell · ${c.city}`}
          title={facts.title}
          lede={
            <>
              <p>{facts.facts[0].text}</p>
              <p className="mt-2 text-sm">
                Updated <time dateTime={updatedIso}>{updatedLabel}</time> · MLS® sales, refreshed monthly
              </p>
            </>
          }
          hero={best[0] ? MONTH_NAMES[best[0].month - 1] : fastest ? MONTH_NAMES[fastest.month - 1] : null}
          heroSub={best[0] ? `best month, ${signedPct(best[0].price!.pct)} on price` : "fastest month to sell"}
        />

        <section className="mt-4 grid gap-3 sm:grid-cols-3" aria-label="Key figures">
          {worst[0] && <StatCard label="Weakest month" value={MONTH_NAMES[worst[0].month - 1]} sub={`${signedPct(worst[0].price!.pct)} against the average month.`} />}
          {fastest && <StatCard label="Fastest month" value={`${fastest.medianDom} days`} sub={`Median days on market, ${MONTH_NAMES[fastest.month - 1]}.`} />}
          <StatCard label="Sales measured" value={c.sales.toLocaleString("en-CA")} sub={facts.window} />
        </section>

        <section className="mt-8 rounded-2xl border border-border bg-card/40 p-5 sm:p-6" aria-labelledby="shows">
          <h2 id="shows" className="text-lg font-semibold">What the data shows</h2>
          <ul className="mt-3 space-y-2 text-sm leading-relaxed">
            {facts.facts.map((f) => (
              <li key={f.id} className="flex gap-2">
                <Dot />
                <span>{f.text}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-8 rounded-2xl border border-border bg-card/40 p-5 sm:p-6" aria-labelledby="months">
          <h2 id="months" className="text-lg font-semibold">{c.city} home sales by month</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Month the deal was signed, {facts.window}. Price = similar homes against the average month, trend removed; * = not significant (95% range includes zero).
          </p>
          <div className="mt-3 overflow-x-auto">
            <MonthPriceTable months={c.months} />
          </div>
        </section>

        {c.weekdays.length > 0 && (
          <section className="mt-8 rounded-2xl border border-border bg-card/40 p-5 sm:p-6" aria-labelledby="weekdays">
            <h2 id="weekdays" className="text-lg font-semibold">By the day the home was listed</h2>
            <table className="mt-3 w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Listed on</th>
                  <th className="py-2 pr-3 text-right font-medium">Sales</th>
                  <th className="py-2 pr-3 text-right font-medium">Over asking</th>
                  <th className="py-2 text-right font-medium">Days on market</th>
                </tr>
              </thead>
              <tbody>
                {c.weekdays.map((w) => (
                  <tr key={w.day} className="border-b border-border/60">
                    <td className="py-2 pr-3">{WEEKDAY_NAMES[w.day]}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{w.sales.toLocaleString("en-CA")}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{w.overAskShare ?? "–"}%</td>
                    <td className="py-2 text-right tabular-nums">{w.medianDom ?? "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <RequestCards city={c.city} citySlug={c.slug} />

        <div className="mx-auto max-w-3xl">
          <div className="mt-8">
            <HubFaq faqs={facts.faqs} heading={`Selling in ${c.city}: common questions`} />
          </div>
          <CiteBox citation={citation} />
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{BEST_TIME_SOURCE_LINE}</p>
          <section className="mt-8">
            <h2 className="text-sm font-semibold text-muted-foreground">Best time to sell in other cities</h2>
            <div className="mt-2 flex flex-wrap gap-2">
              {others.map((o) => (
                <Link
                  key={o.slug}
                  href={bestTimeToSellPath(o.slug)}
                  className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
                >
                  {o.city}
                </Link>
              ))}
            </div>
          </section>
          <CityTopicLinks citySlug={c.slug} current="best-time-to-sell" />
        </div>
      </div>
    </main>
  );
}
