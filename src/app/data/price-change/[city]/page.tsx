/**
 * /data/price-change/{city} — "Are home prices dropping in {city}?" Same-home price change
 * against a year earlier, by home type and quarter by quarter. Every sentence comes from
 * buildPriceChangeFacts (src/lib/data/priceChange.ts); the FAQ and Dataset JSON-LD reuse it.
 *
 * Fully static from data/price-change.json (rebuilt monthly by refresh-price-change.yml).
 * Same-home medians only; no forecast.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TrendingDown } from "lucide-react";
import HubFaq from "@/components/seo/HubFaq";
import { CiteBox, HeaderCard, RequestCards, StatCard } from "@/components/dataPage/parts";
import { CityChangeBars, QuarterBars } from "@/components/priceChange/PriceChangeCharts";
import CityTopicLinks from "@/components/seo/CityTopicLinks";
import ListingComplianceNotice from "@/components/legal/ListingComplianceNotice";
import {
  PRICE_CHANGE_SOURCE_LINE,
  buildPriceChangeFacts,
  changeLabel,
  getPriceChangeData,
  priceChangeAreaBySlug,
  priceChangePath,
  rankedAreas,
} from "@/lib/data/priceChange";
import { TYPE_GROUPS, TYPE_LABEL } from "@/lib/data/priceChangeModel";
import { titleYear } from "@/lib/seo/titleYear";
import { ogImageUrl } from "@/lib/og/ogImageUrl";
import { metaDescription } from "@/lib/seo/metaDescription";
import { DATA_PUBLISHER } from "@/lib/seo/publisher";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");
export const dynamicParams = false;

export function generateStaticParams() {
  return getPriceChangeData()
    .cities.filter((c) => c.all)
    .map((c) => ({ city: c.slug }));
}

function load(slug: string) {
  const a = priceChangeAreaBySlug(slug);
  if (!a) return null;
  const file = getPriceChangeData();
  const facts = buildPriceChangeFacts(a, file, titleYear());
  return facts ? { a, file, facts } : null;
}

export async function generateMetadata({ params }: { params: Promise<{ city: string }> }): Promise<Metadata> {
  const { city: slug } = await params;
  const loaded = load(slug);
  if (!loaded) return {};
  const { a, facts } = loaded;
  const canonical = `${SITE_URL}${priceChangePath(a.slug)}`;
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
      images: [ogImageUrl({ eyebrow: "Price change", title: `Are home prices dropping in ${a.city}?`, subtitle: "Same homes against a year earlier." })],
    },
  };
}

function Dot() {
  return <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-600 dark:bg-teal-400" />;
}

export default async function PriceChangeCityPage({ params }: { params: Promise<{ city: string }> }) {
  const { city: slug } = await params;
  const loaded = load(slug);
  if (!loaded) notFound();
  const { a, file, facts } = loaded;
  const canonical = `${SITE_URL}${priceChangePath(a.slug)}`;
  const updatedIso = file.generatedAt.slice(0, 10);
  const updatedLabel = new Date(file.generatedAt).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric", timeZone: "America/Toronto" });
  const citation = `PureProperty, "${facts.title}", updated ${updatedLabel}, ${canonical.replace(/^https?:\/\/(www\.)?/, "")}`;
  const ranked = rankedAreas(file);
  const lastQ = [...a.quarters].reverse().find((q) => q.all);
  const typed = TYPE_GROUPS.filter((t) => a.byType[t]);

  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
      { "@type": "ListItem", position: 2, name: "Data", item: `${SITE_URL}/data` },
      { "@type": "ListItem", position: 3, name: "Price change", item: `${SITE_URL}${priceChangePath()}` },
      { "@type": "ListItem", position: 4, name: a.city, item: canonical },
    ],
  };
  const dataset = {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: facts.title,
    description: facts.facts.map((f) => f.text).join(" "),
    url: canonical,
    dateModified: updatedIso,
    temporalCoverage: `${file.earlierFrom}/${file.laterTo}`,
    isAccessibleForFree: true,
    creator: DATA_PUBLISHER,
    publisher: DATA_PUBLISHER,
    spatialCoverage: { "@type": "Place", name: `${a.city}, Ontario, Canada` },
    measurementTechnique: "Same-home median price change within matched groups (community, type, bedrooms, size band), cluster bootstrap 95% ranges. " + PRICE_CHANGE_SOURCE_LINE,
    variableMeasured: facts.measures.map((m) => ({ "@type": "PropertyValue", ...m })),
  };

  return (
    <main className="min-h-app bg-background text-foreground">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(dataset) }} />
      <div className="mx-auto max-w-4xl px-4 py-8">
        <nav className="mb-5 text-sm text-muted-foreground">
          <Link href="/data" className="hover:text-foreground">Data</Link>
          <span className="mx-2">/</span>
          <Link href={priceChangePath()} className="hover:text-foreground">Price change</Link>
          <span className="mx-2">/</span>
          <span className="text-foreground">{a.city}</span>
        </nav>

        <HeaderCard
          Icon={TrendingDown}
          eyebrow={`Price change · ${a.city}`}
          title={facts.title}
          lede={
            <>
              <p>{facts.summary}</p>
              <p className="mt-2 text-sm">
                Updated <time dateTime={updatedIso}>{updatedLabel}</time> · MLS® sales, refreshed monthly
              </p>
            </>
          }
          hero={changeLabel(a.all!).replace(" (no clear change)", "")}
          heroSub={`same homes, ${facts.window} vs a year earlier`}
        />

        <section className="mt-4 grid gap-3 sm:grid-cols-3" aria-label="Key figures">
          {lastQ?.all && <StatCard label={`Latest quarter, ${lastQ.label}`} value={changeLabel(lastQ.all)} sub="Against the same quarter a year earlier." />}
          {a.byType.detached && <StatCard label="Detached houses" value={changeLabel(a.byType.detached)} sub={a.medianPrice.detached ? `Median sale price $${a.medianPrice.detached.toLocaleString("en-CA")}.` : "Same homes, last 12 months."} />}
          {a.byType.condoApt ? (
            <StatCard label="Condo apartments" value={changeLabel(a.byType.condoApt)} sub={a.medianPrice.condoApt ? `Median sale price $${a.medianPrice.condoApt.toLocaleString("en-CA")}.` : "Same homes, last 12 months."} />
          ) : (
            <StatCard label="Homes sold" value={a.sales.toLocaleString("en-CA")} sub={`In ${a.city}, ${facts.window}.`} />
          )}
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

        <section className="mt-8 rounded-2xl border border-border bg-card/40 p-5 sm:p-6" aria-labelledby="quarters">
          <h2 id="quarters" className="text-lg font-semibold">Is the drop getting smaller? Quarter by quarter</h2>
          <p className="mt-1 text-sm text-muted-foreground">Each quarter against the same quarter a year earlier, same homes. n.c. = no clear change.</p>
          <div className="mt-4">
            <QuarterBars quarters={a.quarters} />
          </div>
        </section>

        <section className="mt-8 rounded-2xl border border-border bg-card/40 p-5 sm:p-6" aria-labelledby="types">
          <h2 id="types" className="text-lg font-semibold">By home type, {facts.window}</h2>
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Home type</th>
                <th className="py-2 pr-3 text-right font-medium">Change, same homes</th>
                <th className="py-2 text-right font-medium">Median price</th>
              </tr>
            </thead>
            <tbody>
              {typed.map((t) => (
                <tr key={t} className="border-b border-border/60">
                  <td className="py-2 pr-3">{TYPE_LABEL[t]}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{changeLabel(a.byType[t]!)}</td>
                  <td className="py-2 text-right tabular-nums">{a.medianPrice[t] ? `$${a.medianPrice[t]!.toLocaleString("en-CA")}` : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-muted-foreground">Median price = plain median of homes sold in the last 12 months, for context. The change column is the same-home figure.</p>
        </section>

        <section className="mt-8 rounded-2xl border border-border bg-card/40 p-5 sm:p-6" aria-labelledby="outlook">
          <h2 id="outlook" className="text-lg font-semibold">What this means for {titleYear() + 1}</h2>
          <p className="mt-2 text-sm leading-relaxed">{facts.outlook}</p>
        </section>

        <section className="mt-8 rounded-2xl border border-border bg-card/40 p-5 sm:p-6" aria-labelledby="compare">
          <h2 id="compare" className="text-lg font-semibold">{a.city} against the other cities</h2>
          <p className="mt-1 text-sm text-muted-foreground">All home types, same homes, largest drop first.</p>
          <div className="mt-4">
            <CityChangeBars areas={ranked} current={a.slug} />
          </div>
        </section>

        <RequestCards city={a.city} citySlug={a.slug} />

        <div className="mx-auto max-w-3xl">
          <section className="mt-10" aria-labelledby="how">
            <h2 id="how" className="text-lg font-semibold">How we measured it</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              A city&rsquo;s median price moves when the mix of homes sold changes, not only when prices change. So each sale is grouped with
              similar homes: the same community, home type, bedrooms above ground and size band. Each group&rsquo;s median price in {facts.window} is
              compared with its own median in {facts.earlierWindow}, and the groups are averaged, weighted by sales. Groups need at least 3 sales in
              each period (2 for a single quarter). Each 95% range comes from 500 resamples of the groups. Sold prices from $150,000 to $8,000,000,
              by the date the deal was signed.
            </p>
          </section>

          <div className="mt-8">
            <HubFaq faqs={facts.faqs} heading={`Home prices in ${a.city}: common questions`} />
          </div>

          <CiteBox citation={citation} />
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{PRICE_CHANGE_SOURCE_LINE}</p>

          <CityTopicLinks citySlug={a.slug} current="price-change" />

          <div className="mt-8">
            <ListingComplianceNotice />
          </div>
        </div>
      </div>
    </main>
  );
}
