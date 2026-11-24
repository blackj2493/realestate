/**
 * /data/condo-prices — "Ontario condo prices {year} by city": one row per city (median price,
 * price per sq ft, monthly fee, fee per sq ft, sale-to-asking). City pages carry unit types and
 * communities. Fully static from data/condo-prices.json (see src/lib/data/condoPrices.ts).
 */
import type { Metadata } from "next";
import Link from "next/link";
import { Building2 } from "lucide-react";
import HubFaq from "@/components/seo/HubFaq";
import { CiteBox, HeaderCard, PriceOpinionCard } from "@/components/dataPage/parts";
import ListingComplianceNotice from "@/components/legal/ListingComplianceNotice";
import { CONDO_SOURCE_LINE, condoPricesPath, fee2, getCondoData, money, rankedCondoCities } from "@/lib/data/condoPrices";
import { titleYear } from "@/lib/seo/titleYear";
import { ogImageUrl } from "@/lib/og/ogImageUrl";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function load() {
  const file = getCondoData();
  const ranked = rankedCondoCities(file);
  const year = titleYear();
  const title = `Ontario Condo Prices ${year} by City: Price per Sq Ft and Condo Fees`;
  const from = `${MONTHS[Number(file.from.slice(5, 7)) - 1]} ${file.from.slice(0, 4)}`;
  const toM = Number(file.to.slice(5, 7));
  const to = toM === 1 ? `Dec ${Number(file.to.slice(0, 4)) - 1}` : `${MONTHS[toM - 2]} ${file.to.slice(0, 4)}`;
  const window = `${from} to ${to}`;
  const top = ranked[0];
  const low = ranked[ranked.length - 1];
  const fees = ranked.filter((c) => c.all.feePsf).sort((x, y) => y.all.feePsf! - x.all.feePsf!);
  const summary =
    `Condo apartments sold for about ${money(top.all.pricePsf!)} a square foot in ${top.city} and ${money(low.all.pricePsf!)} in ${low.city} (${window}, ${ranked.length} cities).` +
    (fees.length ? ` Condo fees ran from about ${fee2(fees[0].all.feePsf!)} a square foot a month (${fees[0].city}) to ${fee2(fees[fees.length - 1].all.feePsf!)} (${fees[fees.length - 1].city}).` : "");
  return { file, ranked, title, summary, window, fees };
}

export function generateMetadata(): Metadata {
  const { title, summary } = load();
  const canonical = `${SITE_URL}${condoPricesPath()}`;
  return {
    metadataBase: new URL(SITE_URL),
    title: `${title} | PureProperty`,
    description: summary,
    alternates: { canonical },
    openGraph: {
      title,
      description: summary,
      url: canonical,
      siteName: "PureProperty",
      type: "article",
      images: [ogImageUrl({ eyebrow: "Condo prices", title: "Ontario condo prices and fees by city", subtitle: "Medians from MLS® sales." })],
    },
  };
}

export default function CondoPricesIndexPage() {
  const { file, ranked, title, summary, window, fees } = load();
  const canonical = `${SITE_URL}${condoPricesPath()}`;
  const updatedIso = file.generatedAt.slice(0, 10);
  const updatedLabel = new Date(file.generatedAt).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric", timeZone: "America/Toronto" });
  const citation = `PureProperty, "${title}", updated ${updatedLabel}, ${canonical.replace(/^https?:\/\/(www\.)?/, "")}`;
  const sales = ranked.reduce((s, c) => s + c.all.sales, 0);
  const maxPsf = Math.max(...ranked.map((c) => c.all.pricePsf ?? 0), 1) * 1.1;

  const faqs = [
    { q: "How much is a condo in Ontario?", a: `${summary} See each city page for prices by unit type and community.` },
    ...(fees.length
      ? [{ q: "What are average condo fees per square foot in Ontario?", a: `Median monthly condo fees: ${fees.map((c) => `${c.city} ${fee2(c.all.feePsf!)}`).join(", ")} a square foot (${window}, approximate).` }]
      : []),
    { q: "Why are per-square-foot figures approximate?", a: "MLS® records give each condo's size as a range, such as 600–699 sq ft, not an exact area. We divide by the middle of the range." },
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
    creator: { "@type": "Organization", name: "PureProperty", url: "https://www.pureproperty.ca" },
    spatialCoverage: { "@type": "Place", name: "Ontario, Canada" },
    measurementTechnique: CONDO_SOURCE_LINE,
    variableMeasured: ranked.map((c) => ({ "@type": "PropertyValue", name: `Median condo price per sq ft, ${c.city}`, value: c.all.pricePsf, unitText: "CAD per sq ft" })),
  };

  return (
    <main className="min-h-app bg-background text-foreground">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(dataset) }} />
      <div className="mx-auto max-w-4xl px-4 py-8">
        <nav className="mb-5 text-sm text-muted-foreground">
          <Link href="/data" className="hover:text-foreground">Data</Link>
          <span className="mx-2">/</span>
          <span className="text-foreground">Condo prices</span>
        </nav>

        <HeaderCard
          Icon={Building2}
          eyebrow="Condo prices · Ontario"
          title={title}
          lede={
            <>
              <p>{summary}</p>
              <p className="mt-2 text-sm">
                Updated <time dateTime={updatedIso}>{updatedLabel}</time> · {sales.toLocaleString("en-CA")} MLS® condo sales, refreshed monthly
              </p>
            </>
          }
          hero={`${ranked.length} cities`}
          heroSub="condo apartment prices and fees"
        />

        <section className="mt-8 rounded-2xl border border-border bg-card/40 p-5 sm:p-6" aria-labelledby="psf">
          <h2 id="psf" className="text-lg font-semibold">Condo price per square foot, by city</h2>
          <p className="mt-1 text-sm text-muted-foreground">Median, approximate, {window}. Highest first.</p>
          <ul className="mt-4 space-y-2">
            {ranked.map((c) => {
              const w = ((c.all.pricePsf ?? 0) / maxPsf) * 100;
              return (
                <li key={c.slug} className="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-3 sm:grid-cols-[9rem_minmax(0,1fr)]">
                  <Link href={condoPricesPath(c.slug)} className="truncate text-sm underline-offset-4 hover:underline">{c.city}</Link>
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 shrink-0 rounded-r-[3px]" style={{ width: `${Math.max(0.8, w) * 0.8}%`, background: "#0d9488" }} aria-hidden="true" />
                    <span className="text-xs tabular-nums text-muted-foreground">{c.all.pricePsf ? money(c.all.pricePsf) : "–"}</span>
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
                  <th className="py-2 pr-3 text-right font-medium">Median price</th>
                  <th className="py-2 pr-3 text-right font-medium">Per sq ft</th>
                  <th className="py-2 pr-3 text-right font-medium">Fee / month</th>
                  <th className="py-2 pr-3 text-right font-medium">Fee / sq ft</th>
                  <th className="py-2 text-right font-medium">Sale to asking</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((c) => (
                  <tr key={c.slug} className="border-b border-border/60">
                    <td className="py-2 pr-3">
                      <Link href={condoPricesPath(c.slug)} className="underline underline-offset-4 hover:text-foreground">{c.city}</Link>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{c.all.sales.toLocaleString("en-CA")}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{c.all.medianPrice ? money(c.all.medianPrice) : "–"}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{c.all.pricePsf ? money(c.all.pricePsf) : "–"}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{c.all.medianFee ? money(c.all.medianFee) : "–"}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{c.all.feePsf ? fee2(c.all.feePsf) : "–"}</td>
                    <td className="py-2 text-right tabular-nums">{c.all.saleToAsk != null ? `${c.all.saleToAsk.toFixed(1)}%` : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Condo apartments only, {window}. Per-sq-ft figures use the middle of the listed size range. See also the{" "}
            <Link href="/data/condo-fees" className="underline">condo fee tracker</Link> for where fees rise fastest.
          </p>
        </section>

        <section className="mt-8 grid gap-3 sm:grid-cols-2">
          <PriceOpinionCard citySlug={null} />
        </section>

        <div className="mx-auto max-w-3xl">
          <div className="mt-8">
            <HubFaq faqs={faqs} heading="Ontario condo prices: common questions" />
          </div>
          <CiteBox citation={citation} />
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{CONDO_SOURCE_LINE}</p>
          <div className="mt-8">
            <ListingComplianceNotice />
          </div>
        </div>
      </div>
    </main>
  );
}
