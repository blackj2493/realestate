/**
 * /data/property-tax/{city} — "how much is property tax in {city}": median annual tax by home
 * type, the middle half of the range, tax per $100,000 of sale price against the other cities,
 * and one row per community. Every sentence comes from buildTaxFacts (src/lib/data/propertyTax.ts).
 *
 * Fully static from data/property-tax.json (rebuilt monthly by refresh-property-tax.yml).
 * Medians only; no home or address is named.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Receipt } from "lucide-react";
import HubFaq from "@/components/seo/HubFaq";
import { CiteBox, HeaderCard, RequestCards, StatCard } from "@/components/dataPage/parts";
import CityTopicLinks from "@/components/seo/CityTopicLinks";
import ListingComplianceNotice from "@/components/legal/ListingComplianceNotice";
import {
  TAX_HOME_LABEL,
  TAX_HOME_TYPES,
  TAX_SOURCE_LINE,
  buildTaxFacts,
  getTaxData,
  money,
  propertyTaxPath,
  rankedTaxCities,
  taxAreaBySlug,
  type TaxStats,
} from "@/lib/data/propertyTax";
import { titleYear } from "@/lib/seo/titleYear";
import { ogImageUrl } from "@/lib/og/ogImageUrl";
import { metaDescription } from "@/lib/seo/metaDescription";
import { DATA_PUBLISHER } from "@/lib/seo/publisher";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");
export const dynamicParams = false;
/** Communities shown before the rest fold into "Show all". */
const SHOWN = 25;

export function generateStaticParams() {
  return getTaxData().cities.map((c) => ({ city: c.slug }));
}

function load(slug: string) {
  const c = taxAreaBySlug(slug);
  if (!c) return null;
  const file = getTaxData();
  const facts = buildTaxFacts(c, file, titleYear());
  return facts ? { c, file, facts } : null;
}

export async function generateMetadata({ params }: { params: Promise<{ city: string }> }): Promise<Metadata> {
  const { city: slug } = await params;
  const loaded = load(slug);
  if (!loaded) return {};
  const { c, facts } = loaded;
  const canonical = `${SITE_URL}${propertyTaxPath(c.slug)}`;
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
      images: [ogImageUrl({ eyebrow: "Property tax", title: `Property tax in ${c.city}`, subtitle: "What owners pay, from MLS® sales." })],
    },
  };
}

function Dot() {
  return <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-600 dark:bg-teal-400" />;
}

function TaxCells({ s }: { s: TaxStats }) {
  return (
    <>
      <td className="py-2 pr-3 text-right tabular-nums">{s.sales.toLocaleString("en-CA")}</td>
      <td className="py-2 pr-3 text-right tabular-nums">{s.medianTax ? money(s.medianTax) : "–"}</td>
      <td className="py-2 pr-3 text-right tabular-nums">{s.lowTax && s.highTax ? `${money(s.lowTax)}–${money(s.highTax)}` : "–"}</td>
      <td className="py-2 pr-3 text-right tabular-nums">{s.medianPrice ? money(s.medianPrice) : "–"}</td>
      <td className="py-2 text-right tabular-nums">{s.taxPer100k != null ? money(s.taxPer100k) : "–"}</td>
    </>
  );
}

function TaxHead({ first }: { first: string }) {
  return (
    <thead>
      <tr className="border-b border-border text-left text-muted-foreground">
        <th className="py-2 pr-3 font-medium">{first}</th>
        <th className="py-2 pr-3 text-right font-medium">Sales</th>
        <th className="py-2 pr-3 text-right font-medium">Median tax / year</th>
        <th className="py-2 pr-3 text-right font-medium">Middle half</th>
        <th className="py-2 pr-3 text-right font-medium">Median price</th>
        <th className="py-2 text-right font-medium">Per $100k</th>
      </tr>
    </thead>
  );
}

function CommunityTable({ rows }: { rows: ({ name: string } & TaxStats)[] }) {
  return (
    <table className="w-full min-w-[40rem] text-sm">
      <TaxHead first="Community" />
      <tbody>
        {rows.map((h) => (
          <tr key={h.name} className="border-b border-border/60">
            <td className="py-2 pr-3">{h.name}</td>
            <TaxCells s={h} />
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default async function PropertyTaxCityPage({ params }: { params: Promise<{ city: string }> }) {
  const { city: slug } = await params;
  const loaded = load(slug);
  if (!loaded) notFound();
  const { c, file, facts } = loaded;
  const a = c.all;
  const canonical = `${SITE_URL}${propertyTaxPath(c.slug)}`;
  const updatedIso = file.generatedAt.slice(0, 10);
  const updatedLabel = new Date(file.generatedAt).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric", timeZone: "America/Toronto" });
  const citation = `PureProperty, "${facts.title}", updated ${updatedLabel}, ${canonical.replace(/^https?:\/\/(www\.)?/, "")}`;
  const types = TAX_HOME_TYPES.filter((t) => c.byType[t]);
  const others = rankedTaxCities(file).filter((x) => x.slug !== c.slug);
  const detached = c.byType.detached;
  const condo = c.byType.condoApt;

  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
      { "@type": "ListItem", position: 2, name: "Data", item: `${SITE_URL}/data` },
      { "@type": "ListItem", position: 3, name: "Property tax", item: `${SITE_URL}${propertyTaxPath()}` },
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
    creator: DATA_PUBLISHER,
    publisher: DATA_PUBLISHER,
    spatialCoverage: { "@type": "Place", name: `${c.city}, Ontario, Canada` },
    measurementTechnique: TAX_SOURCE_LINE,
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
          <Link href={propertyTaxPath()} className="hover:text-foreground">Property tax</Link>
          <span className="mx-2">/</span>
          <span className="text-foreground">{c.city}</span>
        </nav>

        <HeaderCard
          Icon={Receipt}
          eyebrow={`Property tax · ${c.city}`}
          title={facts.title}
          lede={
            <>
              <p>{facts.summary}</p>
              <p className="mt-2 text-sm">
                Updated <time dateTime={updatedIso}>{updatedLabel}</time> · tax bills on MLS® sales, refreshed monthly
              </p>
            </>
          }
          hero={a.medianTax ? `${money(a.medianTax)}/yr` : null}
          heroSub={`median property tax, all homes sold ${facts.window}`}
        />

        <section className="mt-4 grid gap-3 sm:grid-cols-3" aria-label="Key figures">
          {a.medianTax && <StatCard label="Per month" value={money(a.medianTax / 12)} sub="Median annual tax divided by 12." />}
          {detached?.medianTax && <StatCard label="Detached house" value={`${money(detached.medianTax)}/yr`} sub={`Median price ${detached.medianPrice ? money(detached.medianPrice) : "–"}.`} />}
          {condo?.medianTax ? (
            <StatCard label="Condo apartment" value={`${money(condo.medianTax)}/yr`} sub={`Median price ${condo.medianPrice ? money(condo.medianPrice) : "–"}. Condo fees are extra.`} />
          ) : (
            a.taxPer100k != null && <StatCard label="Per $100,000 of price" value={`${money(a.taxPer100k)}/yr`} sub="Median tax as a share of the sale price." />
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

        {types.length > 0 && (
          <section className="mt-8 rounded-2xl border border-border bg-card/40 p-5 sm:p-6" aria-labelledby="types">
            <h2 id="types" className="text-lg font-semibold">Property tax in {c.city} by home type</h2>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[40rem] text-sm">
                <TaxHead first="Home type" />
                <tbody>
                  {types.map((t) => (
                    <tr key={t} className="border-b border-border/60">
                      <td className="py-2 pr-3">{TAX_HOME_LABEL[t]}</td>
                      <TaxCells s={c.byType[t]!} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Middle half: the 25th to the 75th percentile of the annual tax. Per $100k: annual tax per $100,000 of sale price.</p>
          </section>
        )}

        {c.communities.length > 0 && (
          <section className="mt-8 rounded-2xl border border-border bg-card/40 p-5 sm:p-6" aria-labelledby="communities">
            <h2 id="communities" className="text-lg font-semibold">Property tax by community, {c.city}</h2>
            <p className="mt-1 text-sm text-muted-foreground">Communities with at least 25 sales, most sales first. All home types.</p>
            <div className="mt-3 overflow-x-auto">
              <CommunityTable rows={c.communities.slice(0, SHOWN)} />
            </div>
            {c.communities.length > SHOWN && (
              <details className="mt-3">
                <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
                  Show all {c.communities.length} communities
                </summary>
                <div className="mt-2 overflow-x-auto">
                  <CommunityTable rows={c.communities.slice(SHOWN)} />
                </div>
              </details>
            )}
          </section>
        )}

        <RequestCards city={c.city} citySlug={c.slug} />

        <div className="mx-auto max-w-3xl">
          <section className="mt-10" aria-labelledby="how">
            <h2 id="how" className="text-lg font-semibold">How we measured it</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Home sales in {c.city} ($100,000 to $10,000,000) with the deal signed {facts.window}, using the annual property tax entered on each
              MLS® listing: the seller&rsquo;s last tax bill{c.taxYear ? `, mostly for ${c.taxYear}` : ""}. All figures are medians. Amounts under
              $300, over $100,000, or outside 0.1% to 3% of the sale price are left out as entry errors. A buyer&rsquo;s first bill can differ: the
              city sets a new rate each year, and MPAC can change the assessed value.
            </p>
          </section>

          <div className="mt-8">
            <HubFaq faqs={facts.faqs} heading={`Property tax in ${c.city}: common questions`} />
          </div>

          <CiteBox citation={citation} />
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{TAX_SOURCE_LINE}</p>

          <section className="mt-8">
            <h2 className="text-sm font-semibold text-muted-foreground">Property tax in other cities</h2>
            <div className="mt-2 flex flex-wrap gap-2">
              {others.map((o) => (
                <Link
                  key={o.slug}
                  href={propertyTaxPath(o.slug)}
                  className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
                >
                  {o.city}
                </Link>
              ))}
            </div>
          </section>

          <CityTopicLinks citySlug={c.slug} current="property-tax" />

          <div className="mt-8">
            <ListingComplianceNotice />
          </div>
        </div>
      </div>
    </main>
  );
}
