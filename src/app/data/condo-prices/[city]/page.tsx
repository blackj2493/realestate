/**
 * /data/condo-prices/{city} — "{city} condo prices {year}": median sale price by unit type,
 * approximate price per sq ft, monthly fee and fee per sq ft, sale-to-asking, days on market,
 * same-unit price change, and one row per community. Every sentence comes from
 * buildCondoFacts (src/lib/data/condoPrices.ts).
 *
 * Fully static from data/condo-prices.json (rebuilt monthly by refresh-condo-prices.yml).
 * Medians only; no building is named.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Building2 } from "lucide-react";
import HubFaq from "@/components/seo/HubFaq";
import { CiteBox, HeaderCard, RequestCards, StatCard } from "@/components/dataPage/parts";
import CityTopicLinks from "@/components/seo/CityTopicLinks";
import ListingComplianceNotice from "@/components/legal/ListingComplianceNotice";
import {
  CONDO_SOURCE_LINE,
  UNIT_LABEL,
  UNIT_TYPES,
  buildCondoFacts,
  condoAreaBySlug,
  condoPricesPath,
  fee2,
  getCondoData,
  money,
  rankedCondoCities,
} from "@/lib/data/condoPrices";
import { titleYear } from "@/lib/seo/titleYear";
import { ogImageUrl } from "@/lib/og/ogImageUrl";
import { metaDescription } from "@/lib/seo/metaDescription";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");
export const dynamicParams = false;
/** Communities shown before the rest fold into "Show all". */
const SHOWN = 25;

export function generateStaticParams() {
  return getCondoData().cities.map((c) => ({ city: c.slug }));
}

function load(slug: string) {
  const c = condoAreaBySlug(slug);
  if (!c) return null;
  const file = getCondoData();
  const facts = buildCondoFacts(c, file, titleYear());
  return facts ? { c, file, facts } : null;
}

export async function generateMetadata({ params }: { params: Promise<{ city: string }> }): Promise<Metadata> {
  const { city: slug } = await params;
  const loaded = load(slug);
  if (!loaded) return {};
  const { c, facts } = loaded;
  const canonical = `${SITE_URL}${condoPricesPath(c.slug)}`;
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
      images: [ogImageUrl({ eyebrow: "Condo prices", title: `${c.city} condo prices and fees`, subtitle: "Medians from MLS® sales." })],
    },
  };
}

function Dot() {
  return <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-600 dark:bg-teal-400" />;
}

type Row = { name: string; sales: number; medianPrice: number | null; pricePsf: number | null; medianFee: number | null; feePsf: number | null };

function CommunityRows({ rows }: { rows: Row[] }) {
  return (
    <>
      {rows.map((h) => (
        <tr key={h.name} className="border-b border-border/60">
          <td className="py-2 pr-3">{h.name}</td>
          <td className="py-2 pr-3 text-right tabular-nums">{h.sales.toLocaleString("en-CA")}</td>
          <td className="py-2 pr-3 text-right tabular-nums">{h.medianPrice ? money(h.medianPrice) : "–"}</td>
          <td className="py-2 pr-3 text-right tabular-nums">{h.pricePsf ? money(h.pricePsf) : "–"}</td>
          <td className="py-2 pr-3 text-right tabular-nums">{h.medianFee ? money(h.medianFee) : "–"}</td>
          <td className="py-2 text-right tabular-nums">{h.feePsf ? fee2(h.feePsf) : "–"}</td>
        </tr>
      ))}
    </>
  );
}

function CommunityTable({ rows }: { rows: Row[] }) {
  return (
    <table className="w-full min-w-[38rem] text-sm">
      <thead>
        <tr className="border-b border-border text-left text-muted-foreground">
          <th className="py-2 pr-3 font-medium">Community</th>
          <th className="py-2 pr-3 text-right font-medium">Sales</th>
          <th className="py-2 pr-3 text-right font-medium">Median price</th>
          <th className="py-2 pr-3 text-right font-medium">Per sq ft</th>
          <th className="py-2 pr-3 text-right font-medium">Fee / month</th>
          <th className="py-2 text-right font-medium">Fee / sq ft</th>
        </tr>
      </thead>
      <tbody>
        <CommunityRows rows={rows} />
      </tbody>
    </table>
  );
}

export default async function CondoPricesCityPage({ params }: { params: Promise<{ city: string }> }) {
  const { city: slug } = await params;
  const loaded = load(slug);
  if (!loaded) notFound();
  const { c, file, facts } = loaded;
  const a = c.all;
  const canonical = `${SITE_URL}${condoPricesPath(c.slug)}`;
  const updatedIso = file.generatedAt.slice(0, 10);
  const updatedLabel = new Date(file.generatedAt).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric", timeZone: "America/Toronto" });
  const citation = `PureProperty, "${facts.title}", updated ${updatedLabel}, ${canonical.replace(/^https?:\/\/(www\.)?/, "")}`;
  const units = UNIT_TYPES.filter((u) => c.byUnit[u]);
  const others = rankedCondoCities(file).filter((x) => x.slug !== c.slug);

  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
      { "@type": "ListItem", position: 2, name: "Data", item: `${SITE_URL}/data` },
      { "@type": "ListItem", position: 3, name: "Condo prices", item: `${SITE_URL}${condoPricesPath()}` },
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
    measurementTechnique: CONDO_SOURCE_LINE,
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
          <Link href={condoPricesPath()} className="hover:text-foreground">Condo prices</Link>
          <span className="mx-2">/</span>
          <span className="text-foreground">{c.city}</span>
        </nav>

        <HeaderCard
          Icon={Building2}
          eyebrow={`Condo prices · ${c.city}`}
          title={facts.title}
          lede={
            <>
              <p>{facts.summary}</p>
              <p className="mt-2 text-sm">
                Updated <time dateTime={updatedIso}>{updatedLabel}</time> · MLS® sales, refreshed monthly
              </p>
            </>
          }
          hero={a.medianPrice ? money(a.medianPrice) : null}
          heroSub={`median condo apartment price, ${facts.window}`}
        />

        <section className="mt-4 grid gap-3 sm:grid-cols-3" aria-label="Key figures">
          {a.pricePsf && <StatCard label="Price per sq ft" value={money(a.pricePsf)} sub="Median, approximate (size is listed as a range)." />}
          {a.medianFee && <StatCard label="Condo fee" value={`${money(a.medianFee)}/mo`} sub={a.feePsf ? `About ${fee2(a.feePsf)} a square foot a month.` : "Median monthly fee."} />}
          {a.saleToAsk != null && <StatCard label="Sale to asking" value={`${a.saleToAsk.toFixed(1)}%`} sub={`${a.overAskShare}% sold over asking; median ${a.medianDom ?? "–"} days on the market.`} />}
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

        {units.length > 0 && (
          <section className="mt-8 rounded-2xl border border-border bg-card/40 p-5 sm:p-6" aria-labelledby="units">
            <h2 id="units" className="text-lg font-semibold">{c.city} condo prices by unit type</h2>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[34rem] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Unit</th>
                    <th className="py-2 pr-3 text-right font-medium">Sales</th>
                    <th className="py-2 pr-3 text-right font-medium">Median price</th>
                    <th className="py-2 pr-3 text-right font-medium">Size (sq ft)</th>
                    <th className="py-2 text-right font-medium">Fee / month</th>
                  </tr>
                </thead>
                <tbody>
                  {units.map((u) => {
                    const s = c.byUnit[u]!;
                    return (
                      <tr key={u} className="border-b border-border/60">
                        <td className="py-2 pr-3">{UNIT_LABEL[u]}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{s.sales.toLocaleString("en-CA")}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{s.medianPrice ? money(s.medianPrice) : "–"}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{s.medianSqft ? `~${s.medianSqft.toLocaleString("en-CA")}` : "–"}</td>
                        <td className="py-2 text-right tabular-nums">{s.medianFee ? money(s.medianFee) : "–"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {c.communities.length > 0 && (
          <section className="mt-8 rounded-2xl border border-border bg-card/40 p-5 sm:p-6" aria-labelledby="communities">
            <h2 id="communities" className="text-lg font-semibold">Condo prices and fees by community, {c.city}</h2>
            <p className="mt-1 text-sm text-muted-foreground">Communities with at least 25 condo sales, most sales first. Per-sq-ft figures are approximate.</p>
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
              Condo apartment sales in {c.city} ($100,000 to $6,000,000) with the deal signed {facts.window}. All figures are medians. The MLS®
              record gives each unit&rsquo;s size as a range, such as 600&ndash;699 sq ft, so price and fee per square foot use the middle of the
              range and are approximate. Fees are the monthly maintenance fee in the listing, kept between $50 and $5,000 a month. The same-unit
              price change compares similar units in the same community with a year earlier; see{" "}
              <Link href={`/data/price-change/${c.slug}`} className="underline">price change in {c.city}</Link>.
            </p>
          </section>

          <div className="mt-8">
            <HubFaq faqs={facts.faqs} heading={`Condos in ${c.city}: common questions`} />
          </div>

          <CiteBox citation={citation} />
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{CONDO_SOURCE_LINE}</p>

          <section className="mt-8">
            <h2 className="text-sm font-semibold text-muted-foreground">Condo prices in other cities</h2>
            <div className="mt-2 flex flex-wrap gap-2">
              {others.map((o) => (
                <Link
                  key={o.slug}
                  href={condoPricesPath(o.slug)}
                  className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
                >
                  {o.city}
                </Link>
              ))}
            </div>
          </section>

          <CityTopicLinks citySlug={c.slug} current="condo-prices" />

          <div className="mt-8">
            <ListingComplianceNotice />
          </div>
        </div>
      </div>
    </main>
  );
}
