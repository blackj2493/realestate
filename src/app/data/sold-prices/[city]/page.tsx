/**
 * /data/sold-prices/{city} — "{city} sold prices {year}": median sold price by home type,
 * detached houses by bedrooms, and every community with 25+ sales. Medians only; a reader who
 * wants the sales behind them signs in (VOW). Every sentence comes from buildSoldFacts.
 *
 * Fully static from data/sold-prices.json (rebuilt monthly by refresh-sold-prices.yml).
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Receipt } from "lucide-react";
import HubFaq from "@/components/seo/HubFaq";
import { CiteBox, HeaderCard, RequestCards, StatCard } from "@/components/dataPage/parts";
import CityTopicLinks from "@/components/seo/CityTopicLinks";
import ListingComplianceNotice from "@/components/legal/ListingComplianceNotice";
import { SOLD_SOURCE_LINE, buildSoldFacts, getSoldData, money, rankedSoldCities, soldCityBySlug, soldPricesPath, type SoldCommunity } from "@/lib/data/soldPrices";
import { TYPE_GROUPS, TYPE_LABEL } from "@/lib/data/priceChangeModel";
import { titleYear } from "@/lib/seo/titleYear";
import { ogImageUrl } from "@/lib/og/ogImageUrl";
import { metaDescription } from "@/lib/seo/metaDescription";
import { DATA_PUBLISHER } from "@/lib/seo/publisher";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");
export const dynamicParams = false;
const SHOWN = 25;
const SHORT: Record<string, string> = { detached: "Detached", semiTown: "Semi & town", condoApt: "Condo apt", condoTown: "Condo town" };

export function generateStaticParams() {
  return getSoldData().cities.map((c) => ({ city: c.slug }));
}

function load(slug: string) {
  const c = soldCityBySlug(slug);
  if (!c) return null;
  const file = getSoldData();
  const facts = buildSoldFacts(c, file, titleYear());
  return facts ? { c, file, facts } : null;
}

export async function generateMetadata({ params }: { params: Promise<{ city: string }> }): Promise<Metadata> {
  const { city: slug } = await params;
  const loaded = load(slug);
  if (!loaded) return {};
  const { c, facts } = loaded;
  const canonical = `${SITE_URL}${soldPricesPath(c.slug)}`;
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
      images: [ogImageUrl({ eyebrow: "Sold prices", title: `${c.city} sold prices`, subtitle: "Medians by neighbourhood and home type." })],
    },
  };
}

function Dot() {
  return <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-600 dark:bg-teal-400" />;
}

function CommunityTable({ rows }: { rows: SoldCommunity[] }) {
  return (
    <table className="w-full min-w-[40rem] text-sm">
      <thead>
        <tr className="border-b border-border text-left text-muted-foreground">
          <th className="py-2 pr-3 font-medium">Community</th>
          <th className="py-2 pr-3 text-right font-medium">Sales</th>
          <th className="py-2 pr-3 text-right font-medium">All homes</th>
          {TYPE_GROUPS.map((t) => (
            <th key={t} className="py-2 pr-3 text-right font-medium">{SHORT[t]}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((h) => (
          <tr key={h.name} className="border-b border-border/60">
            <td className="py-2 pr-3">{h.name}</td>
            <td className="py-2 pr-3 text-right tabular-nums">{h.sales.toLocaleString("en-CA")}</td>
            <td className="py-2 pr-3 text-right tabular-nums">{money(h.medianPrice)}</td>
            {TYPE_GROUPS.map((t) => (
              <td key={t} className="py-2 pr-3 text-right tabular-nums">{h.byType[t] ? money(h.byType[t]!) : "–"}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default async function SoldPricesCityPage({ params }: { params: Promise<{ city: string }> }) {
  const { city: slug } = await params;
  const loaded = load(slug);
  if (!loaded) notFound();
  const { c, file, facts } = loaded;
  const a = c.all;
  const canonical = `${SITE_URL}${soldPricesPath(c.slug)}`;
  const updatedIso = file.generatedAt.slice(0, 10);
  const updatedLabel = new Date(file.generatedAt).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric", timeZone: "America/Toronto" });
  const citation = `PureProperty, "${facts.title}", updated ${updatedLabel}, ${canonical.replace(/^https?:\/\/(www\.)?/, "")}`;
  const types = TYPE_GROUPS.filter((t) => c.byType[t]);
  const others = rankedSoldCities(file).filter((x) => x.slug !== c.slug);

  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
      { "@type": "ListItem", position: 2, name: "Data", item: `${SITE_URL}/data` },
      { "@type": "ListItem", position: 3, name: "Sold prices", item: `${SITE_URL}${soldPricesPath()}` },
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
    measurementTechnique: SOLD_SOURCE_LINE,
    variableMeasured: [
      { "@type": "PropertyValue", name: "Median sold price, all homes", value: a.medianPrice, unitText: "CAD" },
      ...types.map((t) => ({ "@type": "PropertyValue", name: `Median sold price, ${TYPE_LABEL[t].toLowerCase()}`, value: c.byType[t]!.medianPrice, unitText: "CAD" })),
    ],
  };

  return (
    <main className="min-h-app bg-background text-foreground">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(dataset) }} />
      <div className="mx-auto max-w-4xl px-4 py-8">
        <nav className="mb-5 text-sm text-muted-foreground">
          <Link href="/data" className="hover:text-foreground">Data</Link>
          <span className="mx-2">/</span>
          <Link href={soldPricesPath()} className="hover:text-foreground">Sold prices</Link>
          <span className="mx-2">/</span>
          <span className="text-foreground">{c.city}</span>
        </nav>

        <HeaderCard
          Icon={Receipt}
          eyebrow={`Sold prices · ${c.city}`}
          title={facts.title}
          lede={
            <>
              <p>{facts.facts[0].text}</p>
              <p className="mt-2 text-sm">
                Updated <time dateTime={updatedIso}>{updatedLabel}</time> · MLS® sales, refreshed monthly
              </p>
            </>
          }
          hero={a.medianPrice ? money(a.medianPrice) : null}
          heroSub={`median sold price, ${facts.window}`}
        />

        <section className="mt-4 grid gap-3 sm:grid-cols-3" aria-label="Key figures">
          {c.byType.detached?.medianPrice && <StatCard label="Detached houses" value={money(c.byType.detached.medianPrice)} sub={`${c.byType.detached.sales.toLocaleString("en-CA")} sales.`} />}
          {a.saleToAsk != null && <StatCard label="Sale to asking" value={`${a.saleToAsk.toFixed(1)}%`} sub={`${a.overAskShare}% sold over asking.`} />}
          {a.medianDom != null && <StatCard label="Days on market" value={`${a.medianDom}`} sub="Median, homes that sold." />}
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

        <section className="mt-8 grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-border bg-card/40 p-5">
            <h2 className="text-lg font-semibold">By home type</h2>
            <table className="mt-3 w-full text-sm">
              <tbody>
                {types.map((t) => (
                  <tr key={t} className="border-b border-border/60">
                    <td className="py-2 pr-3">{TYPE_LABEL[t]}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{money(c.byType[t]!.medianPrice!)}</td>
                    <td className="py-2 text-right text-xs tabular-nums text-muted-foreground">{c.byType[t]!.sales.toLocaleString("en-CA")} sales</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {c.detachedByBeds.length > 0 && (
            <div className="rounded-2xl border border-border bg-card/40 p-5">
              <h2 className="text-lg font-semibold">Detached houses by bedrooms</h2>
              <table className="mt-3 w-full text-sm">
                <tbody>
                  {c.detachedByBeds.map((b) => (
                    <tr key={b.beds} className="border-b border-border/60">
                      <td className="py-2 pr-3">{b.beds} bedrooms</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{money(b.medianPrice)}</td>
                      <td className="py-2 text-right text-xs tabular-nums text-muted-foreground">{b.sales.toLocaleString("en-CA")} sales</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {c.communities.length > 0 && (
          <section className="mt-8 rounded-2xl border border-border bg-card/40 p-5 sm:p-6" aria-labelledby="communities">
            <h2 id="communities" className="text-lg font-semibold">Median sold price by community, {c.city}</h2>
            <p className="mt-1 text-sm text-muted-foreground">Communities with 25 or more sales, most sales first. A type column needs 15 sales.</p>
            <div className="mt-3 overflow-x-auto">
              <CommunityTable rows={c.communities.slice(0, SHOWN)} />
            </div>
            {c.communities.length > SHOWN && (
              <details className="mt-3">
                <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">Show all {c.communities.length} communities</summary>
                <div className="mt-2 overflow-x-auto">
                  <CommunityTable rows={c.communities.slice(SHOWN)} />
                </div>
              </details>
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              Want the sales behind a median? <Link href="/login" rel="nofollow" className="underline">Sign in free</Link> to see each sold home with its history (MLS® rules).
            </p>
          </section>
        )}

        <RequestCards city={c.city} citySlug={c.slug} />

        <div className="mx-auto max-w-3xl">
          <div className="mt-8">
            <HubFaq faqs={facts.faqs} heading={`Sold prices in ${c.city}: common questions`} />
          </div>
          <CiteBox citation={citation} />
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{SOLD_SOURCE_LINE}</p>
          <section className="mt-8">
            <h2 className="text-sm font-semibold text-muted-foreground">Sold prices in other cities</h2>
            <div className="mt-2 flex flex-wrap gap-2">
              {others.map((o) => (
                <Link
                  key={o.slug}
                  href={soldPricesPath(o.slug)}
                  className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
                >
                  {o.city}
                </Link>
              ))}
            </div>
          </section>
          <CityTopicLinks citySlug={c.slug} current="sold-prices" />
          <div className="mt-8">
            <ListingComplianceNotice />
          </div>
        </div>
      </div>
    </main>
  );
}
