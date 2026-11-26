/**
 * /data/land-transfer-tax/{city} — "land transfer tax calculator {city}": the calculator, opened
 * on the city's median sold price, and the tax on the median home of each type (the median
 * from data/sold-prices.json, the tax from src/lib/tax/landTransferTax.ts). Toronto adds the
 * municipal tax. Every sentence comes from buildLttFacts (src/lib/data/landTransferTaxPages.ts).
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Landmark } from "lucide-react";
import HubFaq from "@/components/seo/HubFaq";
import { HeaderCard } from "@/components/dataPage/parts";
import CityTopicLinks from "@/components/seo/CityTopicLinks";
import ListingComplianceNotice from "@/components/legal/ListingComplianceNotice";
import LandTransferTaxCalculator from "@/components/data/LandTransferTaxCalculator";
import { buildLttFacts, isToronto, landTransferTaxPath, lttCities, lttCityBySlug, lttRows, money } from "@/lib/data/landTransferTaxPages";
import { getSoldData, soldPricesPath } from "@/lib/data/soldPrices";
import { titleYear } from "@/lib/seo/titleYear";
import { ogImageUrl } from "@/lib/og/ogImageUrl";
import { metaDescription } from "@/lib/seo/metaDescription";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");
export const dynamicParams = false;

export function generateStaticParams() {
  return lttCities().map((c) => ({ city: c.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ city: string }> }): Promise<Metadata> {
  const { city: slug } = await params;
  const c = lttCityBySlug(slug);
  if (!c) return {};
  const f = buildLttFacts(c, titleYear());
  const canonical = `${SITE_URL}${landTransferTaxPath(c.slug)}`;
  return {
    metadataBase: new URL(SITE_URL),
    title: `${f.title} | PureProperty`,
    description: metaDescription(f.summary),
    alternates: { canonical },
    openGraph: {
      title: f.title,
      description: metaDescription(f.summary),
      url: canonical,
      siteName: "PureProperty",
      type: "article",
      images: [ogImageUrl({ eyebrow: "Land transfer tax", title: `Land transfer tax in ${c.city}`, subtitle: "Calculator and the tax on the median home." })],
    },
  };
}

function Dot() {
  return <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-600 dark:bg-teal-400" />;
}

export default async function LandTransferTaxCityPage({ params }: { params: Promise<{ city: string }> }) {
  const { city: slug } = await params;
  const c = lttCityBySlug(slug);
  if (!c) notFound();
  const f = buildLttFacts(c, titleYear());
  const rows = lttRows(c);
  const toronto = isToronto(c.slug);
  const file = getSoldData();
  const canonical = `${SITE_URL}${landTransferTaxPath(c.slug)}`;
  const others = lttCities().filter((x) => x.slug !== c.slug);

  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
      { "@type": "ListItem", position: 2, name: "Data", item: `${SITE_URL}/data` },
      { "@type": "ListItem", position: 3, name: "Land transfer tax", item: `${SITE_URL}${landTransferTaxPath()}` },
      { "@type": "ListItem", position: 4, name: c.city, item: canonical },
    ],
  };

  return (
    <main className="min-h-app bg-background text-foreground">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }} />
      <div className="mx-auto max-w-4xl px-4 py-8">
        <nav className="mb-5 text-sm text-muted-foreground">
          <Link href="/data" className="hover:text-foreground">Data</Link>
          <span className="mx-2">/</span>
          <Link href={landTransferTaxPath()} className="hover:text-foreground">Land transfer tax</Link>
          <span className="mx-2">/</span>
          <span className="text-foreground">{c.city}</span>
        </nav>

        <HeaderCard
          Icon={Landmark}
          eyebrow={`Land transfer tax · ${c.city}`}
          title={f.title}
          lede={<p>{f.summary}</p>}
          hero={money(rows[0].buyer.total)}
          heroSub={`land transfer tax on the median ${money(rows[0].price)} home`}
        />

        <LandTransferTaxCalculator defaultPrice={rows[0].price} defaultToronto={toronto} />

        <section className="mt-8 rounded-2xl border border-border bg-card/40 p-5 sm:p-6" aria-labelledby="median">
          <h2 id="median" className="text-lg font-semibold">Land transfer tax on the median {c.city} home</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Home type</th>
                  <th className="py-2 pr-3 text-right font-medium">Median sold price</th>
                  <th className="py-2 pr-3 text-right font-medium">Land transfer tax</th>
                  <th className="py-2 text-right font-medium">First-time buyer</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.type} className="border-b border-border/60">
                    <td className="py-2 pr-3">{r.label}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{money(r.price)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{money(r.buyer.total)}</td>
                    <td className="py-2 text-right tabular-nums">{money(r.firstTime.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Median sold prices from MLS® sales, {file.from.slice(0, 7)} to the last full month; see{" "}
            <Link href={soldPricesPath(c.slug)} className="underline">sold prices in {c.city}</Link>.{toronto ? " Includes the Toronto municipal tax." : ""}
          </p>
        </section>

        <section className="mt-8 rounded-2xl border border-border bg-card/40 p-5 sm:p-6" aria-labelledby="shows">
          <h2 id="shows" className="text-lg font-semibold">What a buyer in {c.city} pays</h2>
          <ul className="mt-3 space-y-2 text-sm leading-relaxed">
            {f.facts.map((x) => (
              <li key={x.id} className="flex gap-2">
                <Dot />
                <span>{x.text}</span>
              </li>
            ))}
          </ul>
        </section>

        <div className="mx-auto max-w-3xl">
          <div className="mt-8">
            <HubFaq faqs={f.faqs} heading={`Land transfer tax in ${c.city}: common questions`} />
          </div>
          <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
            Rates from ontario.ca and toronto.ca, checked November 2026. This is an estimate for a home (land with one or two single family residences); your
            real estate lawyer confirms the tax at closing.
          </p>

          <section className="mt-8">
            <h2 className="text-sm font-semibold text-muted-foreground">Land transfer tax in other cities</h2>
            <div className="mt-2 flex flex-wrap gap-2">
              {others.map((o) => (
                <Link
                  key={o.slug}
                  href={landTransferTaxPath(o.slug)}
                  className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
                >
                  {o.city}
                </Link>
              ))}
            </div>
          </section>

          <CityTopicLinks citySlug={c.slug} current="land-transfer-tax" />

          <div className="mt-8">
            <ListingComplianceNotice />
          </div>
        </div>
      </div>
    </main>
  );
}
