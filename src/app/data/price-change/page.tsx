/**
 * /data/price-change — "Are home prices dropping in Ontario?" Same-home price change across
 * the 15 covered cities: the pooled figure, houses vs condos quarter by quarter, and one row
 * per city. City pages carry the detail. Fully static from data/price-change.json.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { TrendingDown } from "lucide-react";
import HubFaq from "@/components/seo/HubFaq";
import { CiteBox, HeaderCard, PriceOpinionCard, StatCard } from "@/components/dataPage/parts";
import { CityChangeBars, QuarterBars } from "@/components/priceChange/PriceChangeCharts";
import ListingComplianceNotice from "@/components/legal/ListingComplianceNotice";
import { PRICE_CHANGE_SOURCE_LINE, buildPriceChangeFacts, changeLabel, getPriceChangeData, priceChangePath, rankedAreas } from "@/lib/data/priceChange";
import { TYPE_GROUPS, TYPE_LABEL } from "@/lib/data/priceChangeModel";
import { titleYear } from "@/lib/seo/titleYear";
import { ogImageUrl } from "@/lib/og/ogImageUrl";
import { metaDescription } from "@/lib/seo/metaDescription";
import { DATA_PUBLISHER } from "@/lib/seo/publisher";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");
const PLACE = "the 15 covered Ontario cities";

function load() {
  const file = getPriceChangeData();
  const year = titleYear();
  const facts = buildPriceChangeFacts({ ...file.ontario, city: PLACE }, file, year);
  const title = `Are Home Prices Dropping in Ontario? ${year} Same-Home Price Change by City`;
  return { file, facts, title, year };
}

export function generateMetadata(): Metadata {
  const { facts, title } = load();
  const canonical = `${SITE_URL}${priceChangePath()}`;
  const description = facts?.summary ?? "Same-home price change in Ontario cities against a year earlier.";
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
      images: [ogImageUrl({ eyebrow: "Price change", title: "Are home prices dropping in Ontario?", subtitle: "Same homes against a year earlier, city by city." })],
    },
  };
}

export default function PriceChangeIndexPage() {
  const { file, facts, title, year } = load();
  const o = file.ontario;
  const ranked = rankedAreas(file);
  const canonical = `${SITE_URL}${priceChangePath()}`;
  const updatedIso = file.generatedAt.slice(0, 10);
  const updatedLabel = new Date(file.generatedAt).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric", timeZone: "America/Toronto" });
  const citation = `PureProperty, "${title}", updated ${updatedLabel}, ${canonical.replace(/^https?:\/\/(www\.)?/, "")}`;
  const lastQ = [...o.quarters].reverse().find((q) => q.all);

  const faqs = facts
    ? [
        { q: "Are house prices dropping in Ontario?", a: `${facts.facts[0].text} ${facts.facts.find((f) => f.id === "types")?.text ?? ""}`.trim() },
        { q: `Will house prices drop in Ontario in ${year + 1}?`, a: facts.outlook },
        ...facts.faqs.slice(2),
      ]
    : [];

  const dataset = facts && {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: title,
    description: facts.facts.map((f) => f.text).join(" "),
    url: canonical,
    dateModified: updatedIso,
    temporalCoverage: `${file.earlierFrom}/${file.laterTo}`,
    isAccessibleForFree: true,
    creator: DATA_PUBLISHER,
    publisher: DATA_PUBLISHER,
    spatialCoverage: { "@type": "Place", name: "Ontario, Canada" },
    measurementTechnique: "Same-home median price change within matched groups (community, type, bedrooms, size band), cluster bootstrap 95% ranges. " + PRICE_CHANGE_SOURCE_LINE,
    variableMeasured: ranked.map((a) => ({ "@type": "PropertyValue", name: `Same-home price change, ${a.city}`, value: Math.round(a.all!.pct * 10) / 10, unitText: "percent" })),
  };

  return (
    <main className="min-h-app bg-background text-foreground">
      {dataset && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(dataset) }} />}
      <div className="mx-auto max-w-4xl px-4 py-8">
        <nav className="mb-5 text-sm text-muted-foreground">
          <Link href="/data" className="hover:text-foreground">Data</Link>
          <span className="mx-2">/</span>
          <span className="text-foreground">Price change</span>
        </nav>

        <HeaderCard
          Icon={TrendingDown}
          eyebrow="Price change · Ontario"
          title={title}
          lede={
            <>
              <p>{facts?.summary}</p>
              <p className="mt-2 text-sm">
                Updated <time dateTime={updatedIso}>{updatedLabel}</time> · {o.sales.toLocaleString("en-CA")} MLS® sales in the last 12 months, refreshed monthly
              </p>
            </>
          }
          hero={o.all ? changeLabel(o.all).replace(" (no clear change)", "") : null}
          heroSub={facts ? `same homes, ${facts.window} vs a year earlier` : undefined}
        />

        <section className="mt-4 grid gap-3 sm:grid-cols-3" aria-label="Key figures">
          {lastQ?.all && <StatCard label={`Latest quarter, ${lastQ.label}`} value={changeLabel(lastQ.all)} sub="All home types, against the same quarter a year earlier." />}
          {o.byType.detached && <StatCard label="Detached houses" value={changeLabel(o.byType.detached)} sub="Same homes, last 12 months." />}
          {o.byType.condoApt && <StatCard label="Condo apartments" value={changeLabel(o.byType.condoApt)} sub="Same homes, last 12 months." />}
        </section>

        {facts && (
          <section className="mt-8 rounded-2xl border border-border bg-card/40 p-5 sm:p-6" aria-labelledby="shows">
            <h2 id="shows" className="text-lg font-semibold">What the data shows</h2>
            <ul className="mt-3 space-y-2 text-sm leading-relaxed">
              {facts.facts.map((f) => (
                <li key={f.id} className="flex gap-2">
                  <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-600 dark:bg-teal-400" />
                  <span>{f.text}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="mt-8 rounded-2xl border border-border bg-card/40 p-5 sm:p-6" aria-labelledby="quarters">
          <h2 id="quarters" className="text-lg font-semibold">Is the drop getting smaller? Quarter by quarter</h2>
          <p className="mt-1 text-sm text-muted-foreground">Every city, each quarter against the same quarter a year earlier, same homes.</p>
          <div className="mt-4">
            <QuarterBars quarters={o.quarters} />
          </div>
        </section>

        <section className="mt-8 rounded-2xl border border-border bg-card/40 p-5 sm:p-6" aria-labelledby="by-city">
          <h2 id="by-city" className="text-lg font-semibold">By city, all home types</h2>
          <p className="mt-1 text-sm text-muted-foreground">Same homes, {facts?.window} against a year earlier. Largest drop first.</p>
          <div className="mt-4">
            <CityChangeBars areas={ranked} />
          </div>
        </section>

        <section className="mt-8 rounded-2xl border border-border bg-card/40 p-5 sm:p-6" aria-labelledby="table">
          <h2 id="table" className="text-lg font-semibold">All figures</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">City</th>
                  <th className="py-2 pr-3 text-right font-medium">All</th>
                  {TYPE_GROUPS.map((t) => (
                    <th key={t} className="py-2 pr-3 text-right font-medium">{TYPE_LABEL[t].replace("Semi-detached and townhouses", "Semi & town")}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ranked.map((a) => (
                  <tr key={a.slug} className="border-b border-border/60">
                    <td className="py-2 pr-3">
                      <Link href={priceChangePath(a.slug)} className="underline underline-offset-4 hover:text-foreground">{a.city}</Link>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{changeLabel(a.all!).replace(" (no clear change)", "*")}</td>
                    {TYPE_GROUPS.map((t) => (
                      <td key={t} className="py-2 pr-3 text-right tabular-nums">{a.byType[t] ? changeLabel(a.byType[t]!).replace(" (no clear change)", "*") : "–"}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">* No clear change: the 95% range includes zero. – = too few sales of that type.</p>
        </section>

        <section className="mt-8 grid gap-3 sm:grid-cols-2">
          <PriceOpinionCard citySlug={null} />
        </section>

        <div className="mx-auto max-w-3xl">
          <section className="mt-10" aria-labelledby="how">
            <h2 id="how" className="text-lg font-semibold">How we measured it</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              A median price moves when the mix of homes sold changes, not only when prices change. So each sale is grouped with similar homes in its
              own city: the same community, home type, bedrooms above ground and size band. Each group&rsquo;s median price is compared with its own
              median a year earlier, and the groups are averaged, weighted by sales. Each 95% range comes from 500 resamples of the groups.
            </p>
          </section>

          {faqs.length > 0 && (
            <div className="mt-8">
              <HubFaq faqs={faqs} heading="Ontario home prices: common questions" />
            </div>
          )}

          <CiteBox citation={citation} />
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{PRICE_CHANGE_SOURCE_LINE}</p>

          <div className="mt-8">
            <ListingComplianceNotice />
          </div>
        </div>
      </div>
    </main>
  );
}
