/**
 * /data/basement-value/{city} — "Does a finished basement add value in {city}?" Every
 * sentence comes from buildBasementFacts (src/lib/data/basementValue.ts); the FAQ answers
 * and the Dataset JSON-LD reuse them.
 *
 * Fully static: the figures live in data/basement-value.json (rebuilt monthly by
 * refresh-basement-value.yml), so a page view runs no function and no query. Model
 * estimates and medians only, same category as the /data trackers.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Calculator, Hammer } from "lucide-react";
import HubFaq from "@/components/seo/HubFaq";
import { CiteBox, HeaderCard, LinkCard, PriceOpinionCard, StatCard } from "@/components/dataPage/parts";
import { CityGapBars, ValueVsCost } from "@/components/basementValue/BasementCharts";
import CityTopicLinks from "@/components/seo/CityTopicLinks";
import ListingComplianceNotice from "@/components/legal/ListingComplianceNotice";
import {
  BASEMENT_SOURCE_LINE,
  TYPICAL_COST,
  basementCityBySlug,
  basementValuePath,
  buildBasementFacts,
  gapDollars,
  getBasementData,
  pctLabel,
  rankedCities,
} from "@/lib/data/basementValue";
import { ogImageUrl } from "@/lib/og/ogImageUrl";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");
export const dynamicParams = false;

export function generateStaticParams() {
  return getBasementData()
    .cities.filter((c) => c.modelA)
    .map((c) => ({ city: c.slug }));
}

function load(slug: string) {
  const c = basementCityBySlug(slug);
  if (!c) return null;
  const file = getBasementData();
  const facts = buildBasementFacts(c, file);
  return facts ? { c, file, facts } : null;
}

export async function generateMetadata({ params }: { params: Promise<{ city: string }> }): Promise<Metadata> {
  const { city: slug } = await params;
  const loaded = load(slug);
  if (!loaded) return {};
  const { c, facts } = loaded;
  const canonical = `${SITE_URL}${basementValuePath(c.slug)}`;
  return {
    metadataBase: new URL(SITE_URL),
    title: `${facts.title} | PureProperty`,
    description: facts.summary,
    alternates: { canonical },
    openGraph: {
      title: facts.title,
      description: facts.summary,
      url: canonical,
      siteName: "PureProperty",
      type: "article",
      images: [ogImageUrl({ eyebrow: "Basement value", title: `What a basement adds to a ${c.city} sale price`, subtitle: "Measured on MLS® sales." })],
    },
  };
}

function Dot() {
  return <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-600 dark:bg-teal-400" />;
}

export default async function BasementValueCityPage({ params }: { params: Promise<{ city: string }> }) {
  const { city: slug } = await params;
  const loaded = load(slug);
  if (!loaded) notFound();
  const { c, file, facts } = loaded;
  const a = c.modelA!;
  const med = c.medianPrice;
  const canonical = `${SITE_URL}${basementValuePath(c.slug)}`;
  const updatedIso = file.generatedAt.slice(0, 10);
  const updatedLabel = new Date(file.generatedAt).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric", timeZone: "America/Toronto" });
  const citation = `PureProperty, "${facts.title}", updated ${updatedLabel}, ${canonical.replace(/^https?:\/\/(www\.)?/, "")}`;
  const finUsd = gapDollars(a.effects.fin, med);
  const aptUsd = gapDollars(a.effects.apt, med);
  const ranked = rankedCities(file);
  const rank = ranked.findIndex((x) => x.slug === c.slug) + 1;

  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
      { "@type": "ListItem", position: 2, name: "Data", item: `${SITE_URL}/data` },
      { "@type": "ListItem", position: 3, name: "Basement value", item: `${SITE_URL}${basementValuePath()}` },
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
    temporalCoverage: `${file.salesFrom}/${file.salesTo}`,
    isAccessibleForFree: true,
    creator: { "@type": "Organization", name: "PureProperty", url: "https://www.pureproperty.ca" },
    spatialCoverage: { "@type": "Place", name: `${c.city}, Ontario, Canada` },
    measurementTechnique: "Within-community comparison of similar houses (log-price regression), cluster bootstrap 95% ranges. " + BASEMENT_SOURCE_LINE,
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
          <Link href={basementValuePath()} className="hover:text-foreground">Basement value</Link>
          <span className="mx-2">/</span>
          <span className="text-foreground">{c.city}</span>
        </nav>

        <HeaderCard
          Icon={Hammer}
          eyebrow={`Basement value · ${c.city}`}
          title={facts.title}
          lede={
            <>
              <p>{facts.summary}</p>
              <p className="mt-2 text-sm">
                Updated <time dateTime={updatedIso}>{updatedLabel}</time> · MLS® sales, refreshed monthly
              </p>
            </>
          }
          hero={finUsd != null ? `+$${Math.round(finUsd / 1000)}K` : `${a.effects.fin.pct >= 0 ? "+" : "−"}${Math.abs(a.effects.fin.pct).toFixed(1)}%`}
          heroSub="a finished basement added at sale"
          heroExtra={
            med ? (
              <p className="text-sm text-muted-foreground">
                Median house price <span className="font-semibold text-foreground">${med.toLocaleString("en-CA")}</span>
              </p>
            ) : null
          }
        />

        <section className="mt-4 grid gap-3 sm:grid-cols-3" aria-label="Key figures">
          <StatCard
            label="Basement apartment"
            value={aptUsd != null ? `+$${Math.round(aptUsd / 1000)}K` : "n.s."}
            sub={`${a.effects.apt.pct >= 0 ? "+" : "−"}${Math.abs(a.effects.apt.pct).toFixed(1)}% at sale; ${c.groups.apt.toLocaleString("en-CA")} houses sold with one.`}
          />
          {c.rent.twoBed ? (
            <StatCard
              label="2-bed basement rent"
              value={`$${c.rent.twoBed.median.toLocaleString("en-CA")}`}
              sub={`Median a month, ${c.rent.twoBed.leases.toLocaleString("en-CA")} leases, ${facts.rentWindow}.`}
            />
          ) : (
            <StatCard label="Houses compared" value={c.sales.toLocaleString("en-CA")} sub={`House sales in ${c.city}, ${facts.window}.`} />
          )}
          <StatCard label="City rank" value={`${rank} of ${ranked.length}`} sub="Covered cities, by what a finished basement added, largest first." />
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

        <section className="mt-8 rounded-2xl border border-border bg-card/40 p-5 sm:p-6" aria-labelledby="payback">
          <h2 id="payback" className="text-lg font-semibold">Gain at sale against the typical cost, {c.city}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Gain at the {c.city} median house price. Costs are typical GTA contractor figures, not quotes.
          </p>
          <div className="mt-4">
            <ValueVsCost
              rows={[
                { label: "Finished basement (no apartment)", added: finUsd, addedPct: pctLabel(a.effects.fin), cost: TYPICAL_COST.fin },
                { label: "Basement apartment", added: aptUsd, addedPct: pctLabel(a.effects.apt), cost: TYPICAL_COST.apt },
              ]}
            />
          </div>
          <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
            A basement apartment also earns rent while you own the house. A legal second unit needs a building permit and,
            in many cities, a registration. Check the City of {c.city} rules before you build or buy one.
          </p>
        </section>

        <section className="mt-8 rounded-2xl border border-border bg-card/40 p-5 sm:p-6" aria-labelledby="compare">
          <h2 id="compare" className="text-lg font-semibold">{c.city} against the other cities</h2>
          <p className="mt-1 text-sm text-muted-foreground">Sale price gap against a similar house without a finished basement. n.s. = not significant.</p>
          <div className="mt-4">
            <CityGapBars cities={ranked} current={c.slug} />
          </div>
        </section>

        <section className="mt-8 grid gap-3 sm:grid-cols-2">
          <LinkCard
            href={`/whats-my-home-hiding?utm_source=pureproperty&utm_medium=data-page&utm_campaign=basement-value-${c.slug}`}
            Icon={Calculator}
            title="What would add the most to your house?"
            text="See which projects add the most value to your own house, from sales near you."
          />
          <PriceOpinionCard citySlug={c.slug} />
        </section>

        <div className="mx-auto max-w-3xl">
          <section className="mt-10" aria-labelledby="how">
            <h2 id="how" className="text-lg font-semibold">How we measured it</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              We took {c.sales.toLocaleString("en-CA")} freehold house sales in {c.city} (detached, semi-detached, townhouse and link,
              $300,000 to $4,000,000), with the deal signed {facts.window}. Each house is compared only with similar houses: the same
              community, home type, bedrooms above ground and size band. The model also controls for parking, lot width,
              &ldquo;fully renovated&rdquo; or fixer-upper words in the listing, and the quarter of the sale. &ldquo;Basement apartment&rdquo;
              means the listing says apartment or the house has a kitchen below grade; not all of these are registered second units.
              The comparison group is similar houses whose listing describes neither a finished basement nor an apartment. Each 95%
              range comes from 300 resamples of whole communities.
            </p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Limits: the listing describes the basement, and some descriptions are wrong. The gap is an average for similar houses,
              not a valuation of one house: finish quality and condition still differ. Basement rents are leases whose unit address
              says basement, {facts.rentWindow}.
            </p>
          </section>

          <div className="mt-8">
            <HubFaq faqs={facts.faqs} heading={`Basements in ${c.city}: common questions`} />
          </div>

          <CiteBox citation={citation} />
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{BASEMENT_SOURCE_LINE}</p>

          <CityTopicLinks citySlug={c.slug} current="basement-value" />

          <div className="mt-8">
            <ListingComplianceNotice />
          </div>
        </div>
      </div>
    </main>
  );
}
