/**
 * /data/best-time-to-sell — "Best time to sell a house in Ontario {year}": one row per city
 * with its best and weakest month on price (similar homes, trend removed), the gap between
 * them, and the fastest month. City pages carry the full 12 months and the weekday table.
 * Fully static from data/best-time-to-sell.json.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock } from "lucide-react";
import HubFaq from "@/components/seo/HubFaq";
import { CiteBox, HeaderCard, PriceOpinionCard } from "@/components/dataPage/parts";
import {
  BEST_TIME_SOURCE_LINE,
  MONTH_NAMES,
  bestMonths,
  bestTimeToSellPath,
  getBestTimeData,
  seasonSpread,
  signedPct,
  springShare,
  worstMonths,
} from "@/lib/data/bestTimeToSell";
import { titleYear } from "@/lib/seo/titleYear";
import { ogImageUrl } from "@/lib/og/ogImageUrl";
import { metaDescription } from "@/lib/seo/metaDescription";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");

function load() {
  const file = getBestTimeData();
  const title = `Best Time to Sell a House in Ontario (${titleYear()}): The Best Month in Each City`;
  const { spring, withBest } = springShare(file);
  const spreads = file.cities.map(seasonSpread).filter((s): s is number => s != null).sort((a, b) => a - b);
  const sales = file.cities.reduce((s, c) => s + c.sales, 0);
  const winterWorst = file.cities.filter((c) => {
    const w = worstMonths(c)[0];
    return w && (w.month >= 11 || w.month <= 1);
  }).length;
  const summary =
    `In ${spring} of ${withBest} Ontario cities, similar homes sold for the most in spring (March to June), and in ${winterWorst} the weakest month was November, December or January.` +
    (spreads.length ? ` The gap between the best and weakest month was ${spreads[0].toFixed(1)}% to ${spreads[spreads.length - 1].toFixed(1)}% of the price.` : "") +
    ` ${sales.toLocaleString("en-CA")} sales over 2 years.`;
  return { file, title, summary };
}

export function generateMetadata(): Metadata {
  const { title, summary } = load();
  const canonical = `${SITE_URL}${bestTimeToSellPath()}`;
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
      images: [ogImageUrl({ eyebrow: "Best time to sell", title: "The best month to sell in Ontario", subtitle: "Measured on similar homes, city by city." })],
    },
  };
}

export default function BestTimeIndexPage() {
  const { file, title, summary } = load();
  const canonical = `${SITE_URL}${bestTimeToSellPath()}`;
  const updatedIso = file.generatedAt.slice(0, 10);
  const updatedLabel = new Date(file.generatedAt).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric", timeZone: "America/Toronto" });
  const citation = `PureProperty, "${title}", updated ${updatedLabel}, ${canonical.replace(/^https?:\/\/(www\.)?/, "")}`;
  const faqs = [
    { q: "What is the best month to sell a house in Ontario?", a: `${summary} Each city page has all 12 months.` },
    {
      q: "Why do homes sell for less in December?",
      a: "In most cities, fewer homes sell in December, they stay on the market longer and fewer sell over asking (each city page has the month table). The price figures compare similar homes in the same community, so the gap is not explained by the kind of homes that sell in winter.",
    },
  ];

  return (
    <main className="min-h-app bg-background text-foreground">
      <div className="mx-auto max-w-4xl px-4 py-8">
        <nav className="mb-5 text-sm text-muted-foreground">
          <Link href="/data" className="hover:text-foreground">Data</Link>
          <span className="mx-2">/</span>
          <span className="text-foreground">Best time to sell</span>
        </nav>
        <HeaderCard
          Icon={CalendarClock}
          eyebrow="Best time to sell · Ontario"
          title={title}
          lede={
            <>
              <p>{summary}</p>
              <p className="mt-2 text-sm">
                Updated <time dateTime={updatedIso}>{updatedLabel}</time> · MLS® sales, refreshed monthly
              </p>
            </>
          }
          hero={`${file.cities.length} cities`}
          heroSub="price, speed and over-asking by month"
        />
        <section className="mt-8 rounded-2xl border border-border bg-card/40 p-5 sm:p-6" aria-labelledby="table">
          <h2 id="table" className="text-lg font-semibold">Best and weakest month to sell, by city</h2>
          <p className="mt-1 text-sm text-muted-foreground">Price of similar homes against the average month, trend removed. Only months whose 95% range excludes zero are named.</p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">City</th>
                  <th className="py-2 pr-3 font-medium">Best month</th>
                  <th className="py-2 pr-3 font-medium">Weakest month</th>
                  <th className="py-2 pr-3 text-right font-medium">Gap</th>
                  <th className="py-2 text-right font-medium">Fastest month</th>
                </tr>
              </thead>
              <tbody>
                {file.cities.map((c) => {
                  const b = bestMonths(c)[0];
                  const w = worstMonths(c)[0];
                  const s = seasonSpread(c);
                  const f = [...c.months].filter((m) => m.medianDom != null).sort((x, y) => x.medianDom! - y.medianDom!)[0];
                  return (
                    <tr key={c.slug} className="border-b border-border/60">
                      <td className="py-2 pr-3">
                        <Link href={bestTimeToSellPath(c.slug)} className="underline underline-offset-4 hover:text-foreground">{c.city}</Link>
                      </td>
                      <td className="py-2 pr-3">{b ? `${MONTH_NAMES[b.month - 1]} (${signedPct(b.price!.pct)})` : "No clear month"}</td>
                      <td className="py-2 pr-3">{w ? `${MONTH_NAMES[w.month - 1]} (${signedPct(w.price!.pct)})` : "No clear month"}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{s != null ? `${s.toFixed(1)}%` : "–"}</td>
                      <td className="py-2 text-right">{f ? `${MONTH_NAMES[f.month - 1]} (${f.medianDom} days)` : "–"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
        <section className="mt-8 grid gap-3 sm:grid-cols-2">
          <PriceOpinionCard citySlug={null} />
        </section>
        <div className="mx-auto max-w-3xl">
          <div className="mt-8">
            <HubFaq faqs={faqs} heading="Best time to sell in Ontario: common questions" />
          </div>
          <CiteBox citation={citation} />
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{BEST_TIME_SOURCE_LINE}</p>
        </div>
      </div>
    </main>
  );
}
