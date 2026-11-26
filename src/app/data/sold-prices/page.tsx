/**
 * /data/sold-prices — "Ontario sold home prices {year} by city": one row per city with the
 * median sold price for all homes and each home type, and sale-to-asking. City pages carry
 * bedrooms and communities. Fully static from data/sold-prices.json.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { Receipt } from "lucide-react";
import HubFaq from "@/components/seo/HubFaq";
import { CiteBox, HeaderCard, PriceOpinionCard } from "@/components/dataPage/parts";
import ListingComplianceNotice from "@/components/legal/ListingComplianceNotice";
import { SOLD_SOURCE_LINE, getSoldData, money, rankedSoldCities, soldPricesPath } from "@/lib/data/soldPrices";
import { TYPE_GROUPS } from "@/lib/data/priceChangeModel";
import { titleYear } from "@/lib/seo/titleYear";
import { ogImageUrl } from "@/lib/og/ogImageUrl";
import { metaDescription } from "@/lib/seo/metaDescription";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");
const SHORT: Record<string, string> = { detached: "Detached", semiTown: "Semi & town", condoApt: "Condo apt", condoTown: "Condo town" };

function load() {
  const file = getSoldData();
  const ranked = rankedSoldCities(file);
  const title = `Ontario Sold Home Prices ${titleYear()} by City: Median Sold Price by Home Type`;
  const sales = ranked.reduce((s, c) => s + c.all.sales, 0);
  const det = ranked.filter((c) => c.byType.detached?.medianPrice).sort((x, y) => y.byType.detached!.medianPrice! - x.byType.detached!.medianPrice!);
  const summary =
    `Median sold price of a detached house, last 12 months: from ${money(det[0].byType.detached!.medianPrice!)} in ${det[0].city} to ${money(det[det.length - 1].byType.detached!.medianPrice!)} in ${det[det.length - 1].city}` +
    ` (${sales.toLocaleString("en-CA")} sales in ${ranked.length} cities).`;
  return { file, ranked, title, summary };
}

export function generateMetadata(): Metadata {
  const { title, summary } = load();
  const canonical = `${SITE_URL}${soldPricesPath()}`;
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
      images: [ogImageUrl({ eyebrow: "Sold prices", title: "Ontario sold home prices by city", subtitle: "Medians by home type." })],
    },
  };
}

export default function SoldPricesIndexPage() {
  const { file, ranked, title, summary } = load();
  const canonical = `${SITE_URL}${soldPricesPath()}`;
  const updatedIso = file.generatedAt.slice(0, 10);
  const updatedLabel = new Date(file.generatedAt).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric", timeZone: "America/Toronto" });
  const citation = `PureProperty, "${title}", updated ${updatedLabel}, ${canonical.replace(/^https?:\/\/(www\.)?/, "")}`;
  const faqs = [
    { q: "What are homes selling for in Ontario?", a: `${summary} Each city page has the median by home type, bedrooms and community.` },
    { q: "Where can I see individual sold prices?", a: "Under MLS® board rules, individual sold prices are shown only to signed-in users. Sign in free on PureProperty to see each sale; these pages show medians only." },
  ];

  return (
    <main className="min-h-app bg-background text-foreground">
      <div className="mx-auto max-w-4xl px-4 py-8">
        <nav className="mb-5 text-sm text-muted-foreground">
          <Link href="/data" className="hover:text-foreground">Data</Link>
          <span className="mx-2">/</span>
          <span className="text-foreground">Sold prices</span>
        </nav>
        <HeaderCard
          Icon={Receipt}
          eyebrow="Sold prices · Ontario"
          title={title}
          lede={
            <>
              <p>{summary}</p>
              <p className="mt-2 text-sm">
                Updated <time dateTime={updatedIso}>{updatedLabel}</time> · MLS® sales, refreshed monthly
              </p>
            </>
          }
          hero={`${ranked.length} cities`}
          heroSub="median sold prices"
        />
        <section className="mt-8 rounded-2xl border border-border bg-card/40 p-5 sm:p-6" aria-labelledby="table">
          <h2 id="table" className="text-lg font-semibold">Median sold price by city, last 12 months</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[44rem] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">City</th>
                  <th className="py-2 pr-3 text-right font-medium">Sales</th>
                  <th className="py-2 pr-3 text-right font-medium">All homes</th>
                  {TYPE_GROUPS.map((t) => (
                    <th key={t} className="py-2 pr-3 text-right font-medium">{SHORT[t]}</th>
                  ))}
                  <th className="py-2 text-right font-medium">Sale to asking</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((c) => (
                  <tr key={c.slug} className="border-b border-border/60">
                    <td className="py-2 pr-3">
                      <Link href={soldPricesPath(c.slug)} className="underline underline-offset-4 hover:text-foreground">{c.city}</Link>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{c.all.sales.toLocaleString("en-CA")}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{c.all.medianPrice ? money(c.all.medianPrice) : "–"}</td>
                    {TYPE_GROUPS.map((t) => (
                      <td key={t} className="py-2 pr-3 text-right tabular-nums">{c.byType[t]?.medianPrice ? money(c.byType[t]!.medianPrice!) : "–"}</td>
                    ))}
                    <td className="py-2 text-right tabular-nums">{c.all.saleToAsk != null ? `${c.all.saleToAsk.toFixed(1)}%` : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="mt-8 grid gap-3 sm:grid-cols-2">
          <PriceOpinionCard citySlug={null} />
        </section>
        <div className="mx-auto max-w-3xl">
          <div className="mt-8">
            <HubFaq faqs={faqs} heading="Sold prices in Ontario: common questions" />
          </div>
          <CiteBox citation={citation} />
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{SOLD_SOURCE_LINE}</p>
          <div className="mt-8">
            <ListingComplianceNotice />
          </div>
        </div>
      </div>
    </main>
  );
}
