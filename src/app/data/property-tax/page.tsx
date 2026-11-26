/**
 * /data/property-tax — "property tax in Ontario by city": one row per city (median annual tax,
 * detached and condo apartment tax, tax per $100,000 of sale price). City pages carry home types
 * and communities. Fully static from data/property-tax.json (see src/lib/data/propertyTax.ts).
 */
import type { Metadata } from "next";
import Link from "next/link";
import { Receipt } from "lucide-react";
import HubFaq from "@/components/seo/HubFaq";
import { CiteBox, HeaderCard, PriceOpinionCard } from "@/components/dataPage/parts";
import ListingComplianceNotice from "@/components/legal/ListingComplianceNotice";
import { TAX_SOURCE_LINE, getTaxData, money, propertyTaxPath, rankedTaxCities } from "@/lib/data/propertyTax";
import { titleYear } from "@/lib/seo/titleYear";
import { ogImageUrl } from "@/lib/og/ogImageUrl";
import { metaDescription } from "@/lib/seo/metaDescription";
import { DATA_PUBLISHER } from "@/lib/seo/publisher";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function load() {
  const file = getTaxData();
  const ranked = rankedTaxCities(file);
  const year = titleYear();
  const title = `Property Tax in Ontario by City (${year}): What Owners Pay in ${ranked.length} Cities`;
  const from = `${MONTHS[Number(file.from.slice(5, 7)) - 1]} ${file.from.slice(0, 4)}`;
  const toM = Number(file.to.slice(5, 7));
  const to = toM === 1 ? `Dec ${Number(file.to.slice(0, 4)) - 1}` : `${MONTHS[toM - 2]} ${file.to.slice(0, 4)}`;
  const window = `${from} to ${to}`;
  const low = ranked[0];
  const high = ranked[ranked.length - 1];
  const byTax = [...ranked].sort((x, y) => (y.all.medianTax ?? 0) - (x.all.medianTax ?? 0));
  const summary =
    `For every $100,000 of sale price, owners pay about ${money(low.all.taxPer100k!)} a year in property tax in ${low.city} and ${money(high.all.taxPer100k!)} in ${high.city} (${window}, ${ranked.length} cities).` +
    ` The highest median bill is in ${byTax[0].city} (${money(byTax[0].all.medianTax!)} a year), the lowest in ${byTax[byTax.length - 1].city} (${money(byTax[byTax.length - 1].all.medianTax!)}).`;
  return { file, ranked, title, summary, window };
}

export function generateMetadata(): Metadata {
  const { title, summary } = load();
  const canonical = `${SITE_URL}${propertyTaxPath()}`;
  return {
    metadataBase: new URL(SITE_URL),
    title: `${title} | PureProperty`,
    description: metaDescription(summary),
    alternates: { canonical },
    openGraph: {
      title,
      description: metaDescription(summary),
      url: canonical,
      siteName: "PureProperty",
      type: "article",
      images: [ogImageUrl({ eyebrow: "Property tax", title: "Ontario property tax by city", subtitle: "What owners pay, from MLS® sales." })],
    },
  };
}

export default function PropertyTaxIndexPage() {
  const { file, ranked, title, summary, window } = load();
  const canonical = `${SITE_URL}${propertyTaxPath()}`;
  const updatedIso = file.generatedAt.slice(0, 10);
  const updatedLabel = new Date(file.generatedAt).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric", timeZone: "America/Toronto" });
  const citation = `PureProperty, "${title}", updated ${updatedLabel}, ${canonical.replace(/^https?:\/\/(www\.)?/, "")}`;
  const sales = ranked.reduce((s, c) => s + c.all.sales, 0);
  const maxRate = Math.max(...ranked.map((c) => c.all.taxPer100k ?? 0), 1) * 1.1;

  const faqs = [
    { q: "How much is property tax in Ontario?", a: `${summary} See each city page for the tax by home type and community.` },
    {
      q: "Which Ontario city has the lowest property tax?",
      a: `As a share of the sale price, the lowest are ${ranked
        .slice(0, 3)
        .map((c) => `${c.city} (${money(c.all.taxPer100k!)} per $100,000)`)
        .join(", ")}; the highest are ${ranked
        .slice(-3)
        .reverse()
        .map((c) => `${c.city} (${money(c.all.taxPer100k!)})`)
        .join(", ")}. A lower rate on a higher price can still mean a bigger bill.`,
    },
    {
      q: "How is property tax calculated in Ontario?",
      a: "Your municipality multiplies your home's assessed value from MPAC by its residential tax rate, which includes the provincial education rate. The assessed value is not the market price. The amounts on these pages are what sellers paid, as reported on their listings.",
    },
  ];

  const dataset = {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: title,
    description: summary,
    url: canonical,
    dateModified: updatedIso,
    temporalCoverage: `${file.from}/${file.to}`,
    isAccessibleForFree: true,
    creator: DATA_PUBLISHER,
    publisher: DATA_PUBLISHER,
    spatialCoverage: { "@type": "Place", name: "Ontario, Canada" },
    measurementTechnique: TAX_SOURCE_LINE,
    variableMeasured: ranked.map((c) => ({ "@type": "PropertyValue", name: `Median annual property tax, ${c.city}`, value: c.all.medianTax, unitText: "CAD per year" })),
  };

  return (
    <main className="min-h-app bg-background text-foreground">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(dataset) }} />
      <div className="mx-auto max-w-4xl px-4 py-8">
        <nav className="mb-5 text-sm text-muted-foreground">
          <Link href="/data" className="hover:text-foreground">Data</Link>
          <span className="mx-2">/</span>
          <span className="text-foreground">Property tax</span>
        </nav>

        <HeaderCard
          Icon={Receipt}
          eyebrow="Property tax · Ontario"
          title={title}
          lede={
            <>
              <p>{summary}</p>
              <p className="mt-2 text-sm">
                Updated <time dateTime={updatedIso}>{updatedLabel}</time> · tax bills on {sales.toLocaleString("en-CA")} MLS® sales, refreshed monthly
              </p>
            </>
          }
          hero={`${ranked.length} cities`}
          heroSub="what owners pay in property tax"
        />

        <section className="mt-8 rounded-2xl border border-border bg-card/40 p-5 sm:p-6" aria-labelledby="rate">
          <h2 id="rate" className="text-lg font-semibold">Property tax per $100,000 of sale price, by city</h2>
          <p className="mt-1 text-sm text-muted-foreground">Median annual tax as a share of the sale price, {window}. Lowest first.</p>
          <ul className="mt-4 space-y-2">
            {ranked.map((c) => {
              const w = ((c.all.taxPer100k ?? 0) / maxRate) * 100;
              return (
                <li key={c.slug} className="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-3 sm:grid-cols-[9rem_minmax(0,1fr)]">
                  <Link href={propertyTaxPath(c.slug)} className="truncate text-sm underline-offset-4 hover:underline">{c.city}</Link>
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 shrink-0 rounded-r-[3px]" style={{ width: `${Math.max(0.8, w) * 0.8}%`, background: "#0d9488" }} aria-hidden="true" />
                    <span className="text-xs tabular-nums text-muted-foreground">{c.all.taxPer100k != null ? money(c.all.taxPer100k) : "–"}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="mt-8 rounded-2xl border border-border bg-card/40 p-5 sm:p-6" aria-labelledby="table">
          <h2 id="table" className="text-lg font-semibold">All figures</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">City</th>
                  <th className="py-2 pr-3 text-right font-medium">Sales</th>
                  <th className="py-2 pr-3 text-right font-medium">Median tax / year</th>
                  <th className="py-2 pr-3 text-right font-medium">Detached</th>
                  <th className="py-2 pr-3 text-right font-medium">Condo apt</th>
                  <th className="py-2 text-right font-medium">Per $100k</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((c) => (
                  <tr key={c.slug} className="border-b border-border/60">
                    <td className="py-2 pr-3">
                      <Link href={propertyTaxPath(c.slug)} className="underline underline-offset-4 hover:text-foreground">{c.city}</Link>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{c.all.sales.toLocaleString("en-CA")}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{c.all.medianTax ? money(c.all.medianTax) : "–"}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{c.byType.detached?.medianTax ? money(c.byType.detached.medianTax) : "–"}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{c.byType.condoApt?.medianTax ? money(c.byType.condoApt.medianTax) : "–"}</td>
                    <td className="py-2 text-right tabular-nums">{c.all.taxPer100k != null ? money(c.all.taxPer100k) : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            All home types sold {window}, using the annual tax on each listing (the seller&rsquo;s last bill). Medians only.
          </p>
        </section>

        <section className="mt-8 grid gap-3 sm:grid-cols-2">
          <PriceOpinionCard citySlug={null} />
        </section>

        <div className="mx-auto max-w-3xl">
          <div className="mt-8">
            <HubFaq faqs={faqs} heading="Ontario property tax: common questions" />
          </div>
          <CiteBox citation={citation} />
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{TAX_SOURCE_LINE}</p>
          <div className="mt-8">
            <ListingComplianceNotice />
          </div>
        </div>
      </div>
    </main>
  );
}
