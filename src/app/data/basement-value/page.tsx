/**
 * /data/basement-value — "Does a finished basement add value in Ontario?" One table of every
 * covered city: what a finished basement, a basement apartment and a separate entrance added
 * at sale, and what basement units rent for. City pages carry the detail.
 *
 * Fully static from data/basement-value.json (see src/lib/data/basementValue.ts).
 */
import type { Metadata } from "next";
import Link from "next/link";
import { Hammer } from "lucide-react";
import HubFaq from "@/components/seo/HubFaq";
import { CiteBox, HeaderCard, PriceOpinionCard, LinkCard } from "@/components/dataPage/parts";
import { CityGapBars } from "@/components/basementValue/BasementCharts";
import ListingComplianceNotice from "@/components/legal/ListingComplianceNotice";
import { Calculator } from "lucide-react";
import {
  BASEMENT_SOURCE_LINE,
  TYPICAL_COST,
  basementValuePath,
  getBasementData,
  lastMonthLabel,
  monthLabel,
  rankedCities,
} from "@/lib/data/basementValue";
import type { Effect } from "@/lib/data/basementValueModel";
import { ogImageUrl } from "@/lib/og/ogImageUrl";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");
const TITLE = "Does a Finished Basement Add Value in Ontario?";

const cell = (e: Effect) => `${e.pct >= 0 ? "+" : "−"}${Math.abs(e.pct).toFixed(1)}%${e.significant ? "" : "*"}`;

function overview() {
  const file = getBasementData();
  const ranked = rankedCities(file);
  const top = ranked[0];
  const low = ranked[ranked.length - 1];
  const sales = ranked.reduce((s, c) => s + c.sales, 0);
  const window = `${monthLabel(file.salesFrom)} to ${lastMonthLabel(file.salesTo)}`;
  const sepSig = ranked.filter((c) => c.modelA!.effects.sep.significant && c.modelA!.effects.sep.pct > 0);
  const nothingWithBaths = ranked.filter((c) => c.modelB && !c.modelB.effects.fin.significant);
  const aptSame = ranked.filter((c) => !c.modelA!.aptMinusFin.significant);
  const summary =
    `Across ${ranked.length} Ontario cities and ${sales.toLocaleString("en-CA")} house sales (${window}), a finished basement added ` +
    `from ${top.modelA!.effects.fin.pct.toFixed(1)}% (${top.city}) down to ${low.modelA!.effects.fin.pct.toFixed(1)}% (${low.city}) to the sale price of a similar house.`;
  return { file, ranked, top, low, sales, window, sepSig, nothingWithBaths, aptSame, summary };
}

export function generateMetadata(): Metadata {
  const { summary } = overview();
  const canonical = `${SITE_URL}${basementValuePath()}`;
  return {
    metadataBase: new URL(SITE_URL),
    title: `${TITLE} City by City | PureProperty`,
    description: summary,
    alternates: { canonical },
    openGraph: {
      title: TITLE,
      description: summary,
      url: canonical,
      siteName: "PureProperty",
      type: "article",
      images: [ogImageUrl({ eyebrow: "Basement value", title: "What a basement adds to an Ontario sale price", subtitle: "City by city, measured on MLS® sales." })],
    },
  };
}

export default function BasementValueIndexPage() {
  const { file, ranked, top, low, sales, window, sepSig, nothingWithBaths, aptSame, summary } = overview();
  const canonical = `${SITE_URL}${basementValuePath()}`;
  const updatedIso = file.generatedAt.slice(0, 10);
  const updatedLabel = new Date(file.generatedAt).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric", timeZone: "America/Toronto" });
  const citation = `PureProperty, "${TITLE}", updated ${updatedLabel}, ${canonical.replace(/^https?:\/\/(www\.)?/, "")}`;
  const rentCities = ranked.filter((c) => c.rent.twoBed).sort((x, y) => y.rent.twoBed!.median - x.rent.twoBed!.median);

  const facts = [
    `A finished basement added the most in ${top.city} (${top.modelA!.effects.fin.pct.toFixed(1)}%) and the least in ${low.city} (${low.modelA!.effects.fin.pct.toFixed(1)}%).`,
    aptSame.length >= ranked.length / 2
      ? `A basement apartment added about the same as a plain finished basement in ${aptSame.length} of ${ranked.length} cities (no significant difference). Its extra value is the rent.`
      : `A basement apartment added a different amount from a plain finished basement in ${ranked.length - aptSame.length} of ${ranked.length} cities.`,
    nothingWithBaths.length
      ? `With the bathroom count held the same, a finished basement added nothing measurable in ${nothingWithBaths.map((c) => c.city).join(", ")}: there, the basement bathroom carries the gain.`
      : `With the bathroom count held the same, the gain is smaller in every city: much of it is the basement bathroom.`,
    sepSig.length
      ? `A separate entrance added a measurable amount on top of the same basement only in ${sepSig.map((c) => c.city).join(", ")}.`
      : `A separate entrance added nothing measurable on top of the same basement in any city.`,
    rentCities.length
      ? `2-bedroom basement units leased for a median $${rentCities[rentCities.length - 1].rent.twoBed!.median.toLocaleString("en-CA")} (${rentCities[rentCities.length - 1].city}) to $${rentCities[0].rent.twoBed!.median.toLocaleString("en-CA")} (${rentCities[0].city}) a month.`
      : null,
  ].filter((x): x is string => Boolean(x));

  const faqs = [
    { q: "Does a finished basement add value in Ontario?", a: `${summary} ${facts[0]}` },
    { q: "Does a basement apartment add value?", a: facts[1] + " See each city page for the measured figures." },
    { q: "Is a separate entrance worth it?", a: facts[3] },
    {
      q: "How much does it cost to finish a basement?",
      a: `Typical GTA contractor figures (2024–2026): about $${TYPICAL_COST.fin.toLocaleString("en-CA")} for a finished basement, $${TYPICAL_COST.apt.toLocaleString("en-CA")} for a basement apartment and $${TYPICAL_COST.sep.toLocaleString("en-CA")} for a separate entrance. These are not quotes.`,
    },
  ];

  const dataset = {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: TITLE,
    description: [summary, ...facts].join(" "),
    url: canonical,
    dateModified: updatedIso,
    temporalCoverage: `${file.salesFrom}/${file.salesTo}`,
    isAccessibleForFree: true,
    creator: { "@type": "Organization", name: "PureProperty", url: "https://www.pureproperty.ca" },
    spatialCoverage: { "@type": "Place", name: "Ontario, Canada" },
    measurementTechnique: "Within-community comparison of similar houses (log-price regression), cluster bootstrap 95% ranges. " + BASEMENT_SOURCE_LINE,
    variableMeasured: ranked.map((c) => ({ "@type": "PropertyValue", name: `Finished basement price gap, ${c.city}`, value: Math.round(c.modelA!.effects.fin.pct * 10) / 10, unitText: "percent" })),
  };

  return (
    <main className="min-h-app bg-background text-foreground">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(dataset) }} />
      <div className="mx-auto max-w-4xl px-4 py-8">
        <nav className="mb-5 text-sm text-muted-foreground">
          <Link href="/data" className="hover:text-foreground">Data</Link>
          <span className="mx-2">/</span>
          <span className="text-foreground">Basement value</span>
        </nav>

        <HeaderCard
          Icon={Hammer}
          eyebrow="Basement value · Ontario"
          title={TITLE}
          lede={
            <>
              <p>{summary}</p>
              <p className="mt-2 text-sm">
                Updated <time dateTime={updatedIso}>{updatedLabel}</time> · MLS® sales, refreshed monthly
              </p>
            </>
          }
          hero={`${ranked.length} cities`}
          heroSub={`${sales.toLocaleString("en-CA")} house sales compared`}
        />

        <section className="mt-8 rounded-2xl border border-border bg-card/40 p-5 sm:p-6" aria-labelledby="shows">
          <h2 id="shows" className="text-lg font-semibold">What the data shows</h2>
          <ul className="mt-3 space-y-2 text-sm leading-relaxed">
            {facts.map((f) => (
              <li key={f} className="flex gap-2">
                <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-600 dark:bg-teal-400" />
                <span>{f}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-8 rounded-2xl border border-border bg-card/40 p-5 sm:p-6" aria-labelledby="by-city">
          <h2 id="by-city" className="text-lg font-semibold">What a basement added at sale, by city</h2>
          <p className="mt-1 text-sm text-muted-foreground">Against a similar house without a finished basement. Largest gain first.</p>
          <div className="mt-4">
            <CityGapBars cities={ranked} />
          </div>
        </section>

        <section className="mt-8 rounded-2xl border border-border bg-card/40 p-5 sm:p-6" aria-labelledby="table">
          <h2 id="table" className="text-lg font-semibold">All figures</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">City</th>
                  <th className="py-2 pr-3 text-right font-medium">Sales</th>
                  <th className="py-2 pr-3 text-right font-medium">Finished</th>
                  <th className="py-2 pr-3 text-right font-medium">Apartment</th>
                  <th className="py-2 pr-3 text-right font-medium">Finished, same baths</th>
                  <th className="py-2 pr-3 text-right font-medium">Separate entrance</th>
                  <th className="py-2 text-right font-medium">2-bed rent</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((c) => (
                  <tr key={c.slug} className="border-b border-border/60">
                    <td className="py-2 pr-3">
                      <Link href={basementValuePath(c.slug)} className="underline underline-offset-4 hover:text-foreground">{c.city}</Link>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{c.sales.toLocaleString("en-CA")}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{cell(c.modelA!.effects.fin)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{cell(c.modelA!.effects.apt)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{c.modelB ? cell(c.modelB.effects.fin) : "–"}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{cell(c.modelA!.effects.sep)}</td>
                    <td className="py-2 text-right tabular-nums">{c.rent.twoBed ? `$${c.rent.twoBed.median.toLocaleString("en-CA")}` : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            * Not significant: the 95% range includes zero. Separate entrance = the gain on top of the same basement type.
            2-bed rent = median monthly rent of basement units, {monthLabel(file.rentsFrom)} to {lastMonthLabel(file.rentsTo)}.
          </p>
        </section>

        <section className="mt-8 grid gap-3 sm:grid-cols-2">
          <LinkCard
            href="/whats-my-home-hiding?utm_source=pureproperty&utm_medium=data-page&utm_campaign=basement-value"
            Icon={Calculator}
            title="What would add the most to your house?"
            text="See which projects add the most value to your own house, from sales near you."
          />
          <PriceOpinionCard citySlug={null} />
        </section>

        <div className="mx-auto max-w-3xl">
          <section className="mt-10" aria-labelledby="how">
            <h2 id="how" className="text-lg font-semibold">How we measured it</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Freehold house sales (detached, semi-detached, townhouse and link, $300,000 to $4,000,000), deals signed {window}.
              Each house is compared only with similar houses in its own city: the same community, home type, bedrooms above ground
              and size band. The model also controls for parking, lot width, renovation or fixer-upper words in the listing, and the
              quarter of the sale. Each 95% range comes from 300 resamples of whole communities. The gap is an average for similar
              houses, not a valuation of one house.
            </p>
          </section>

          <div className="mt-8">
            <HubFaq faqs={faqs} heading="Basements in Ontario: common questions" />
          </div>

          <CiteBox citation={citation} />
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{BASEMENT_SOURCE_LINE}</p>

          <div className="mt-8">
            <ListingComplianceNotice />
          </div>
        </div>
      </div>
    </main>
  );
}
