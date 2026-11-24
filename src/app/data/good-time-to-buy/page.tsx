/**
 * /data/good-time-to-buy — "Is it a good time to buy a house in Ontario?" One row per covered
 * city: market temperature and how many measured signals favour buyers. City pages carry
 * each signal. Hourly revalidate (the market board refreshes nightly).
 */
import type { Metadata } from "next";
import Link from "next/link";
import { Scale } from "lucide-react";
import HubFaq from "@/components/seo/HubFaq";
import { CiteBox, HeaderCard, PriceOpinionCard } from "@/components/dataPage/parts";
import ListingComplianceNotice from "@/components/legal/ListingComplianceNotice";
import { getMarketBoard } from "@/lib/data/marketBoard";
import { SOURCE_LINE, boardRowFor } from "@/lib/data/cityFacts";
import { OUTLOOK_CITIES } from "@/lib/data/outlookCities";
import { buildBuyVerdict, goodTimeToBuyPath, SALE_TO_LIST_BUYER } from "@/lib/data/goodTimeToBuy";
import { priceChangeAreaBySlug } from "@/lib/data/priceChange";
import { titleYear } from "@/lib/seo/titleYear";
import { ogImageUrl } from "@/lib/og/ogImageUrl";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");
export const revalidate = 3600;

async function load() {
  const year = titleYear();
  const title = `Is It a Good Time to Buy a House in Ontario? ${year} Buyer's Market Signals by City`;
  try {
    const board = await getMarketBoard();
    const rows = OUTLOOK_CITIES.map((c) => {
      const row = boardRowFor(board.rows, c.city);
      return { ...c, verdict: row ? buildBuyVerdict(c.city, row, board.rows, priceChangeAreaBySlug(c.slug)) : null };
    }).filter((r) => r.verdict);
    rows.sort((a, b) => b.verdict!.forBuyers / b.verdict!.counted - a.verdict!.forBuyers / a.verdict!.counted);
    const buyers = rows.filter((r) => r.verdict!.market.startsWith("a buyer's"));
    const sellers = rows.filter((r) => r.verdict!.market.startsWith("a seller's"));
    const summary = rows.length
      ? `Of ${rows.length} Ontario cities, ${buyers.length} ${buyers.length === 1 ? "is a buyer's market" : "are buyer's markets"}, ${sellers.length} ${sellers.length === 1 ? "is a seller's market" : "are seller's markets"} and ${rows.length - buyers.length - sellers.length} ${rows.length - buyers.length - sellers.length === 1 ? "is" : "are"} balanced, by sale-to-list and months of supply.` +
        ` Most buyer-friendly by measured signals: ${rows.slice(0, 3).map((r) => r.city).join(", ")}.`
      : "";
    return { title, rows, summary, dataAsOf: board.dataAsOf, year };
  } catch (err) {
    console.error("[good-time-to-buy] board read failed:", err);
    return { title, rows: [], summary: "", dataAsOf: null, year };
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const { title, summary } = await load();
  const canonical = `${SITE_URL}${goodTimeToBuyPath()}`;
  const description = summary || "Measured buyer's and seller's market signals for Ontario cities, from MLS® data.";
  return {
    metadataBase: new URL(SITE_URL),
    title: `${title} | PureProperty`,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      url: canonical,
      siteName: "PureProperty",
      type: "article",
      images: [ogImageUrl({ eyebrow: "Good time to buy?", title: "Is it a good time to buy in Ontario?", subtitle: "Measured market signals, city by city." })],
    },
  };
}

export default async function GoodTimeToBuyIndexPage() {
  const { title, rows, summary, dataAsOf, year } = await load();
  const canonical = `${SITE_URL}${goodTimeToBuyPath()}`;
  const updatedIso = dataAsOf ? new Date(dataAsOf).toISOString() : null;
  const updatedLabel = dataAsOf ? new Date(dataAsOf).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric", timeZone: "America/Toronto" }) : null;
  const citation = `PureProperty, "${title}"${updatedLabel ? `, updated ${updatedLabel}` : ""}, ${canonical.replace(/^https?:\/\/(www\.)?/, "")}`;
  const faqs = [
    { q: `Is it a good time to buy a house in Ontario in ${year}?`, a: `${summary} Whether to buy also depends on your income, savings, mortgage rate and how long you plan to stay; these pages measure the market only.` },
    {
      q: "What makes a buyer's market?",
      a: `Homes selling below asking (a sale-to-list ratio under ${SALE_TO_LIST_BUYER}%), many months of supply, falling same-home prices, and more listings with price cuts or listed for over 90 days than in other cities.`,
    },
  ];

  return (
    <main className="min-h-app bg-background text-foreground">
      <div className="mx-auto max-w-4xl px-4 py-8">
        <nav className="mb-5 text-sm text-muted-foreground">
          <Link href="/data" className="hover:text-foreground">Data</Link>
          <span className="mx-2">/</span>
          <span className="text-foreground">Good time to buy?</span>
        </nav>

        <HeaderCard
          Icon={Scale}
          eyebrow="Good time to buy? · Ontario"
          title={title}
          lede={
            <>
              <p>{summary || "The figures are not available right now."}</p>
              {updatedIso && (
                <p className="mt-2 text-sm">
                  Updated <time dateTime={updatedIso}>{updatedLabel}</time> · MLS® sales and listings, refreshed nightly
                </p>
              )}
            </>
          }
          hero={rows.length ? `${rows.length} cities` : null}
          heroSub="measured signals for buyers"
        />

        {rows.length > 0 && (
          <section className="mt-8 rounded-2xl border border-border bg-card/40 p-5 sm:p-6" aria-labelledby="table">
            <h2 id="table" className="text-lg font-semibold">By city, most buyer-friendly first</h2>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[36rem] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">City</th>
                    <th className="py-2 pr-3 font-medium">Market</th>
                    <th className="py-2 pr-3 text-right font-medium">Signals for buyers</th>
                    <th className="py-2 text-right font-medium">For sellers</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.slug} className="border-b border-border/60">
                      <td className="py-2 pr-3">
                        <Link href={goodTimeToBuyPath(r.slug)} className="underline underline-offset-4 hover:text-foreground">{r.city}</Link>
                      </td>
                      <td className="py-2 pr-3">{r.verdict!.market.replace(/^a /, "").replace(/^./, (x) => x.toUpperCase())}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{r.verdict!.forBuyers} of {r.verdict!.counted}</td>
                      <td className="py-2 text-right tabular-nums">{r.verdict!.forSellers}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Signals: market temperature, same-home price change, sale to asking, listings with a price cut, listings over 90 days. Each city page shows every figure.
            </p>
          </section>
        )}

        <section className="mt-8 grid gap-3 sm:grid-cols-2">
          <PriceOpinionCard citySlug={null} />
        </section>

        <div className="mx-auto max-w-3xl">
          <div className="mt-8">
            <HubFaq faqs={faqs} heading="Buying in Ontario: common questions" />
          </div>
          <CiteBox citation={citation} />
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{SOURCE_LINE}</p>
          <div className="mt-8">
            <ListingComplianceNotice />
          </div>
        </div>
      </div>
    </main>
  );
}
