/**
 * /data/land-transfer-tax — "land transfer tax calculator ontario": the calculator, the Ontario
 * and Toronto brackets, the first-time buyer refunds, and the tax on each city's median sold
 * price. City pages open the calculator on that city's median.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { Landmark } from "lucide-react";
import HubFaq from "@/components/seo/HubFaq";
import { HeaderCard } from "@/components/dataPage/parts";
import ListingComplianceNotice from "@/components/legal/ListingComplianceNotice";
import LandTransferTaxCalculator from "@/components/data/LandTransferTaxCalculator";
import { isToronto, landTransferTaxPath, lttCities, lttRows, money } from "@/lib/data/landTransferTaxPages";
import { ONTARIO_BRACKETS, TORONTO_BRACKETS, landTransferTax } from "@/lib/tax/landTransferTax";
import { titleYear } from "@/lib/seo/titleYear";
import { ogImageUrl } from "@/lib/og/ogImageUrl";
import { metaDescription } from "@/lib/seo/metaDescription";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");
const EXAMPLES = [500_000, 750_000, 1_000_000, 1_500_000, 2_500_000];

function load() {
  const year = titleYear();
  const title = `Ontario Land Transfer Tax Calculator (${year}): Toronto, First-Time Buyers and Every City`;
  const m = landTransferTax(1_000_000, { toronto: false, firstTime: false });
  const t = landTransferTax(1_000_000, { toronto: true, firstTime: false });
  const summary = `On a $1,000,000 home, Ontario land transfer tax is ${money(m.total)}; in Toronto, which adds its own tax, a buyer pays ${money(t.total)}. First-time buyers get up to $4,000 back from Ontario and up to $4,475 from Toronto.`;
  return { title, summary };
}

export function generateMetadata(): Metadata {
  const { title, summary } = load();
  const canonical = `${SITE_URL}${landTransferTaxPath()}`;
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
      images: [ogImageUrl({ eyebrow: "Land transfer tax", title: "Ontario land transfer tax calculator", subtitle: "Toronto, first-time buyers and every city." })],
    },
  };
}

/** 0.005 -> "0.5%", 0.0545 -> "5.45%". */
const pct = (r: number) => `${Number((r * 100).toFixed(2))}%`;

function BracketRows({ brackets }: { brackets: [number, number][] }) {
  return (
    <>
      {brackets.map(([limit, rate], i) => {
        const from = i ? brackets[i - 1][0] : 0;
        return (
          <tr key={limit} className="border-b border-border/60">
            <td className="py-2 pr-3">{limit === Infinity ? `Over ${money(from)}` : `${from ? `${money(from)} to ` : "Up to "}${money(limit)}`}</td>
            <td className="py-2 text-right tabular-nums">{pct(rate)}</td>
          </tr>
        );
      })}
    </>
  );
}

export default function LandTransferTaxIndexPage() {
  const { title, summary } = load();
  const cities = lttCities().map((c) => ({ c, r: lttRows(c)[0] })).sort((x, y) => y.r.buyer.total - x.r.buyer.total);

  const faqs = [
    { q: "How much is land transfer tax in Ontario?", a: `${summary} The tax rises in steps: 0.5% on the first $55,000, then 1%, 1.5%, 2% above $400,000 and 2.5% above $2,000,000.` },
    {
      q: "How much is land transfer tax in Toronto?",
      a: `Toronto buyers pay the Ontario tax and the City's tax. The City's rates match Ontario's up to $3,000,000; since April 1, 2026 they are 4.4% to 8.6% above that. On a $1,000,000 home the two together are ${money(landTransferTax(1_000_000, { toronto: true, firstTime: false }).total)}.`,
    },
    {
      q: "Do first-time home buyers pay land transfer tax in Ontario?",
      a: "Ontario refunds up to $4,000, so a first-time buyer pays no Ontario tax on a home up to about $368,000. In Toronto the City also refunds up to $4,475. You must never have owned a home anywhere, move in within 9 months, and be a Canadian citizen or permanent resident.",
    },
    { q: "When do you pay land transfer tax?", a: "On the closing day. Your real estate lawyer pays it when they register the transfer and claims any first-time buyer refund at the same time." },
  ];

  return (
    <main className="min-h-app bg-background text-foreground">
      <div className="mx-auto max-w-4xl px-4 py-8">
        <nav className="mb-5 text-sm text-muted-foreground">
          <Link href="/data" className="hover:text-foreground">Data</Link>
          <span className="mx-2">/</span>
          <span className="text-foreground">Land transfer tax</span>
        </nav>

        <HeaderCard Icon={Landmark} eyebrow="Land transfer tax · Ontario" title={title} lede={<p>{summary}</p>} hero={`${cities.length} cities`} heroSub="tax on each city's median home" />

        <LandTransferTaxCalculator defaultPrice={1_000_000} defaultToronto={false} />

        <section className="mt-8 rounded-2xl border border-border bg-card/40 p-5 sm:p-6" aria-labelledby="examples">
          <h2 id="examples" className="text-lg font-semibold">Land transfer tax at common prices</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Price</th>
                  <th className="py-2 pr-3 text-right font-medium">Ontario</th>
                  <th className="py-2 pr-3 text-right font-medium">Ontario, first-time</th>
                  <th className="py-2 pr-3 text-right font-medium">Toronto (both taxes)</th>
                  <th className="py-2 text-right font-medium">Toronto, first-time</th>
                </tr>
              </thead>
              <tbody>
                {EXAMPLES.map((p) => (
                  <tr key={p} className="border-b border-border/60">
                    <td className="py-2 pr-3 tabular-nums">{money(p)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{money(landTransferTax(p, { toronto: false, firstTime: false }).total)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{money(landTransferTax(p, { toronto: false, firstTime: true }).total)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{money(landTransferTax(p, { toronto: true, firstTime: false }).total)}</td>
                    <td className="py-2 text-right tabular-nums">{money(landTransferTax(p, { toronto: true, firstTime: true }).total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-8 grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-border bg-card/40 p-5">
            <h2 className="text-base font-semibold">Ontario rates</h2>
            <table className="mt-2 w-full text-sm">
              <tbody>
                <BracketRows brackets={ONTARIO_BRACKETS} />
              </tbody>
            </table>
            <p className="mt-2 text-xs text-muted-foreground">2.5% applies to land with one or two single family residences.</p>
          </div>
          <div className="rounded-2xl border border-border bg-card/40 p-5">
            <h2 className="text-base font-semibold">Toronto municipal rates (from April 1, 2026)</h2>
            <table className="mt-2 w-full text-sm">
              <tbody>
                <BracketRows brackets={TORONTO_BRACKETS} />
              </tbody>
            </table>
            <p className="mt-2 text-xs text-muted-foreground">Paid on top of the Ontario tax, for homes in the City of Toronto only.</p>
          </div>
        </section>

        <section className="mt-8 rounded-2xl border border-border bg-card/40 p-5 sm:p-6" aria-labelledby="cities">
          <h2 id="cities" className="text-lg font-semibold">Land transfer tax on the median home, by city</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">City</th>
                  <th className="py-2 pr-3 text-right font-medium">Median sold price</th>
                  <th className="py-2 pr-3 text-right font-medium">Land transfer tax</th>
                  <th className="py-2 text-right font-medium">First-time buyer</th>
                </tr>
              </thead>
              <tbody>
                {cities.map(({ c, r }) => (
                  <tr key={c.slug} className="border-b border-border/60">
                    <td className="py-2 pr-3">
                      <Link href={landTransferTaxPath(c.slug)} className="underline underline-offset-4 hover:text-foreground">{c.city}</Link>
                      {isToronto(c.slug) ? <span className="text-muted-foreground"> (both taxes)</span> : null}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{money(r.price)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{money(r.buyer.total)}</td>
                    <td className="py-2 text-right tabular-nums">{money(r.firstTime.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <div className="mx-auto max-w-3xl">
          <div className="mt-8">
            <HubFaq faqs={faqs} heading="Ontario land transfer tax: common questions" />
          </div>
          <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
            Rates from ontario.ca and toronto.ca, checked November 2026. An estimate for a home (land with one or two single family residences); your real
            estate lawyer confirms the tax at closing.
          </p>
          <div className="mt-8">
            <ListingComplianceNotice />
          </div>
        </div>
      </div>
    </main>
  );
}
