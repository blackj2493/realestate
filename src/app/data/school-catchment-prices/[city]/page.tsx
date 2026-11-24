/**
 * /data/school-catchment-prices/{city} — "Do better schools raise house prices in {city}?" The
 * premium per school-score point and per score band (similar houses in the same community),
 * and every public elementary catchment with enough sales against similar houses in the city.
 * Every sentence comes from buildSchoolFacts (src/lib/data/schoolPrices.ts).
 *
 * Fully static from data/school-prices.json (rebuilt monthly by refresh-school-prices.yml).
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { GraduationCap } from "lucide-react";
import HubFaq from "@/components/seo/HubFaq";
import { CiteBox, HeaderCard, RequestCards, StatCard } from "@/components/dataPage/parts";
import CityTopicLinks from "@/components/seo/CityTopicLinks";
import ListingComplianceNotice from "@/components/legal/ListingComplianceNotice";
import {
  BAND_LABEL,
  BASE_BAND,
  SCHOOL_SOURCE_LINE,
  SCORE_BANDS,
  buildSchoolFacts,
  getSchoolData,
  schoolCityBySlug,
  schoolPricesPath,
  signedPct,
  type CatchmentRow,
} from "@/lib/data/schoolPrices";
import { titleYear } from "@/lib/seo/titleYear";
import { ogImageUrl } from "@/lib/og/ogImageUrl";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");
export const dynamicParams = false;
const SHOWN = 25;

export function generateStaticParams() {
  return getSchoolData().cities.map((c) => ({ city: c.slug }));
}

function load(slug: string) {
  const c = schoolCityBySlug(slug);
  if (!c) return null;
  const file = getSchoolData();
  const facts = buildSchoolFacts(c, file, titleYear());
  return facts ? { c, file, facts } : null;
}

export async function generateMetadata({ params }: { params: Promise<{ city: string }> }): Promise<Metadata> {
  const { city: slug } = await params;
  const loaded = load(slug);
  if (!loaded) return {};
  const { c, facts } = loaded;
  const canonical = `${SITE_URL}${schoolPricesPath(c.slug)}`;
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
      images: [ogImageUrl({ eyebrow: "School catchments", title: `${c.city}: what a better school adds`, subtitle: "Similar houses, same community." })],
    },
  };
}

function Dot() {
  return <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-600 dark:bg-teal-400" />;
}

function CatchmentTable({ rows }: { rows: CatchmentRow[] }) {
  return (
    <table className="w-full min-w-[34rem] text-sm">
      <thead>
        <tr className="border-b border-border text-left text-muted-foreground">
          <th className="py-2 pr-3 font-medium">Elementary school catchment</th>
          <th className="py-2 pr-3 text-right font-medium">Score</th>
          <th className="py-2 pr-3 text-right font-medium">Sales</th>
          <th className="py-2 pr-3 text-right font-medium">Median price</th>
          <th className="py-2 text-right font-medium">vs similar houses</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.school} className="border-b border-border/60">
            <td className="py-2 pr-3">{r.school}</td>
            <td className="py-2 pr-3 text-right tabular-nums">{r.score.toFixed(1)}</td>
            <td className="py-2 pr-3 text-right tabular-nums">{r.sales.toLocaleString("en-CA")}</td>
            <td className="py-2 pr-3 text-right tabular-nums">${r.medianPrice.toLocaleString("en-CA")}</td>
            <td className="py-2 text-right tabular-nums">{signedPct(r.vsSimilar)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default async function SchoolPricesCityPage({ params }: { params: Promise<{ city: string }> }) {
  const { city: slug } = await params;
  const loaded = load(slug);
  if (!loaded) notFound();
  const { c, file, facts } = loaded;
  const canonical = `${SITE_URL}${schoolPricesPath(c.slug)}`;
  const updatedIso = file.generatedAt.slice(0, 10);
  const updatedLabel = new Date(file.generatedAt).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric", timeZone: "America/Toronto" });
  const citation = `PureProperty, "${facts.title}", updated ${updatedLabel}, ${canonical.replace(/^https?:\/\/(www\.)?/, "")}`;
  const pp = c.perPoint!;
  const top = c.bands["9plus"];
  const bands = SCORE_BANDS.map((b) => ({ b, g: c.bands[b] }));
  const max = Math.max(...bands.map((x) => Math.abs(x.g?.pct ?? 0)), 1) * 1.15;
  const others = getSchoolData().cities.filter((x) => x.slug !== c.slug);

  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
      { "@type": "ListItem", position: 2, name: "Data", item: `${SITE_URL}/data` },
      { "@type": "ListItem", position: 3, name: "School catchment prices", item: `${SITE_URL}${schoolPricesPath()}` },
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
    measurementTechnique: "Within-community comparison of similar houses (log-price regression) by elementary catchment school score, cluster bootstrap 95% ranges. " + SCHOOL_SOURCE_LINE,
    variableMeasured: [
      { "@type": "PropertyValue", name: "Sale price change per school-score point", value: Math.round(pp.pct * 10) / 10, unitText: "percent" },
      ...(top ? [{ "@type": "PropertyValue", name: "Sale price gap, school score 9+ vs 7-8", value: Math.round(top.pct * 10) / 10, unitText: "percent" }] : []),
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
          <Link href={schoolPricesPath()} className="hover:text-foreground">School catchment prices</Link>
          <span className="mx-2">/</span>
          <span className="text-foreground">{c.city}</span>
        </nav>

        <HeaderCard
          Icon={GraduationCap}
          eyebrow={`School catchments · ${c.city}`}
          title={facts.title}
          lede={
            <>
              <p>{facts.summary}</p>
              <p className="mt-2 text-sm">
                Updated <time dateTime={updatedIso}>{updatedLabel}</time> · MLS® sales and {c.board} catchments, refreshed monthly
              </p>
            </>
          }
          hero={pp.significant ? `${signedPct(pp.pct)}` : "No clear premium"}
          heroSub={pp.significant ? "per school-score point, similar houses" : "school score vs price of similar houses"}
        />

        <section className="mt-4 grid gap-3 sm:grid-cols-3" aria-label="Key figures">
          {top && <StatCard label="9+ school vs 7–8" value={top.significant ? signedPct(top.pct) : "n.s."} sub={`${top.sales.toLocaleString("en-CA")} sales in 9+ catchments.`} />}
          <StatCard label="Houses matched" value={c.sales.toLocaleString("en-CA")} sub={`To a ${c.board} catchment, ${facts.window}.`} />
          <StatCard label="Catchments listed" value={c.catchments.length.toLocaleString("en-CA")} sub="With 15 or more house sales." />
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

        <section className="mt-8 rounded-2xl border border-border bg-card/40 p-5 sm:p-6" aria-labelledby="bands">
          <h2 id="bands" className="text-lg font-semibold">Sale price by school score, against a 7–8 school</h2>
          <p className="mt-1 text-sm text-muted-foreground">Similar houses in the same community. Faded = not significant.</p>
          <ul className="mt-4 space-y-2.5">
            {bands.map(({ b, g }) => (
              <li key={b} className="grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-3 text-sm">
                <span>{BAND_LABEL[b]}</span>
                {b === BASE_BAND ? (
                  <span className="text-xs text-muted-foreground">comparison band</span>
                ) : g ? (
                  <span className="flex items-center gap-2">
                    <span className="relative h-3 w-1/2">
                      <span className="absolute inset-y-0 left-1/2 w-px bg-border" aria-hidden="true" />
                      <span
                        className="absolute inset-y-0 rounded-[3px]"
                        style={{
                          left: g.pct >= 0 ? "50%" : `${50 - (Math.abs(g.pct) / max) * 50}%`,
                          width: `${(Math.abs(g.pct) / max) * 50}%`,
                          background: g.significant ? (g.pct >= 0 ? "#0d9488" : "#ea580c") : "rgb(148 163 184 / 0.4)",
                        }}
                        aria-hidden="true"
                      />
                    </span>
                    <span className="text-xs tabular-nums">
                      {signedPct(g.pct)}
                      {g.significant ? "" : " (n.s.)"} · {g.sales.toLocaleString("en-CA")} sales
                    </span>
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">too few sales</span>
                )}
              </li>
            ))}
          </ul>
        </section>

        {c.catchments.length > 0 && (
          <section className="mt-8 rounded-2xl border border-border bg-card/40 p-5 sm:p-6" aria-labelledby="catchments">
            <h2 id="catchments" className="text-lg font-semibold">House prices by elementary school catchment, {c.city}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Median sale against similar houses in {c.city} (same type, bedrooms, size band and half-year). Highest first. This includes the
              neighbourhood, not only the school.
            </p>
            <div className="mt-3 overflow-x-auto">
              <CatchmentTable rows={c.catchments.slice(0, SHOWN)} />
            </div>
            {c.catchments.length > SHOWN && (
              <details className="mt-3">
                <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">Show all {c.catchments.length} catchments</summary>
                <div className="mt-2 overflow-x-auto">
                  <CatchmentTable rows={c.catchments.slice(SHOWN)} />
                </div>
              </details>
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              Catchment boundaries change every year and a postal code can sit across a boundary. Check the zoned school with the {c.board} before you buy.
            </p>
          </section>
        )}

        <RequestCards city={c.city} citySlug={c.slug} />

        <div className="mx-auto max-w-3xl">
          <div className="mt-8">
            <HubFaq faqs={facts.faqs} heading={`Schools and house prices in ${c.city}: common questions`} />
          </div>
          <CiteBox citation={citation} />
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{SCHOOL_SOURCE_LINE}</p>

          <section className="mt-8">
            <h2 className="text-sm font-semibold text-muted-foreground">Other cities</h2>
            <div className="mt-2 flex flex-wrap gap-2">
              {others.map((o) => (
                <Link
                  key={o.slug}
                  href={schoolPricesPath(o.slug)}
                  className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
                >
                  {o.city}
                </Link>
              ))}
            </div>
          </section>

          <CityTopicLinks citySlug={c.slug} current="school-catchment-prices" />
          <div className="mt-8">
            <ListingComplianceNotice />
          </div>
        </div>
      </div>
    </main>
  );
}
