/**
 * One edition of the Ontario Power of Sale Index. Rendered by /data/power-of-sale-index
 * (the latest edition) and /data/power-of-sale-index/{YYYY-MM} (every edition, permanent
 * URL for citation). Server component; all figures are in the HTML.
 */
import Link from "next/link";
import HubFaq from "@/components/seo/HubFaq";
import ListingComplianceNotice from "@/components/legal/ListingComplianceNotice";
import { posIndexPath, editionLabel, type PosIndexEdition } from "@/lib/data/posIndex";
import { SOURCE_LINE } from "@/lib/data/cityFacts";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");
const Dot = () => <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-600 dark:bg-emerald-400" />;

export function posIndexJsonLd(d: PosIndexEdition, canonical: string) {
  return [
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
        { "@type": "ListItem", position: 2, name: "Data", item: `${SITE_URL}/data` },
        { "@type": "ListItem", position: 3, name: "Power of Sale Index", item: `${SITE_URL}${posIndexPath()}` },
        { "@type": "ListItem", position: 4, name: d.label, item: `${SITE_URL}${posIndexPath(d.edition)}` },
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "Dataset",
      name: d.title,
      description: d.facts.map((f) => f.text).join(" "),
      url: canonical,
      temporalCoverage: `${d.series[0]?.edition ?? d.edition}/${d.edition}`,
      isAccessibleForFree: true,
      creator: { "@type": "Organization", name: "PureProperty", url: "https://www.pureproperty.ca" },
      spatialCoverage: { "@type": "Place", name: "Ontario, Canada" },
      measurementTechnique: SOURCE_LINE,
      variableMeasured: d.facts.map((f) => ({ "@type": "PropertyValue", ...f.measure })),
    },
  ];
}

export default function PosIndexView({ d, editions, isLatest }: { d: PosIndexEdition; editions: string[]; isLatest: boolean }) {
  const permalink = `${SITE_URL}${posIndexPath(d.edition)}`;
  const max = Math.max(...d.series.map((p) => p.sharePct), 0.01);
  return (
    <main className="min-h-app bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-4 py-8">
        <nav className="mb-4 text-sm text-muted-foreground">
          <Link href="/data" className="hover:text-foreground">Data</Link>
          <span className="mx-2">/</span>
          <Link href={posIndexPath()} className="hover:text-foreground">Power of Sale Index</Link>
          <span className="mx-2">/</span>
          <span className="text-foreground">{d.label}</span>
        </nav>

        <h1 className="text-2xl font-bold sm:text-3xl">{d.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Monthly · home sales by deal date · MLS® data{isLatest ? " · latest edition" : ""}
        </p>

        <p className="mt-5 text-base leading-relaxed">{d.headline}</p>

        <section className="mt-8" aria-labelledby="shows">
          <h2 id="shows" className="text-lg font-semibold">This month&apos;s figures</h2>
          <ul className="mt-3 space-y-2 text-sm leading-relaxed">
            {d.facts.slice(1).map((f) => (
              <li key={f.id} className="flex gap-2">
                <Dot />
                <span>{f.text}</span>
              </li>
            ))}
          </ul>
        </section>

        {d.series.length > 1 && (
          <section className="mt-8" aria-labelledby="trend">
            <h2 id="trend" className="text-lg font-semibold">Power-of-sale share of Ontario sales, by month</h2>
            <ul className="mt-4 space-y-1.5 text-sm" aria-label="Power-of-sale share of Ontario home sales by month">
              {d.series.map((p) => (
                <li key={p.edition} className="grid grid-cols-[4.75rem_minmax(0,1fr)_6.75rem] items-center gap-2">
                  <span className="whitespace-nowrap text-muted-foreground" title={p.label}>{p.label.slice(0, 3)} {p.edition.slice(0, 4)}</span>
                  <span className="h-3 rounded-r-sm bg-orange-700/85 dark:bg-orange-500/85" style={{ width: `${Math.max(2, (p.sharePct / max) * 100)}%` }} aria-hidden="true" />
                  <span className="text-right tabular-nums">
                    {p.sharePct.toFixed(2)}% <span className="text-muted-foreground">({p.pos})</span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">Share of all home sales that were power of sale; the number of power-of-sale sales in brackets.</p>
          </section>
        )}

        {d.cities.length > 0 && (
          <section className="mt-8" aria-labelledby="cities">
            <h2 id="cities" className="text-lg font-semibold">By city, 12 months from {d.cityWindow}</h2>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[440px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">City</th>
                    <th className="py-2 pr-3 text-right font-medium">Power-of-sale sales</th>
                    <th className="py-2 pr-3 text-right font-medium">Share of sales</th>
                    <th className="py-2 text-right font-medium">12 months before</th>
                  </tr>
                </thead>
                <tbody>
                  {d.cities.map((c) => (
                    <tr key={c.slug} className="border-b border-border/60">
                      <td className="py-2 pr-3">
                        <Link href={`/power-of-sale/${c.slug}`} className="underline hover:text-foreground">{c.city}</Link>
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{c.pos.toLocaleString("en-CA")} of {c.sales.toLocaleString("en-CA")}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{c.sharePct.toFixed(2)}%</td>
                      <td className="py-2 text-right tabular-nums">{c.prevSharePct != null ? `${c.prevSharePct.toFixed(2)}%` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Cities with 500+ sales in the 12 months. The earlier share is shown when both periods have 10+ power-of-sale sales.
            </p>
          </section>
        )}

        <section className="mt-8" aria-labelledby="method">
          <h2 id="method" className="text-lg font-semibold">How the index is made</h2>
          <p className="mt-2 text-sm leading-relaxed">
            A sale counts as power of sale when its MLS® listing description says so (power of sale, foreclosure, bank-owned, court-ordered or receivership) and does not say it is not one. Listings that do not mention it are not counted, so the true number can be higher. Sales are dated by the day the deal was made, not the closing day. Late-reported sales can raise the newest month a little in the following weeks.
          </p>
          <p className="mt-2 text-sm">
            <Link href="/data/findings/ontario-power-of-sale-discount" className="underline hover:text-foreground">
              Our research: how much less power-of-sale homes sell for than similar homes →
            </Link>
          </p>
        </section>

        <div className="mt-8">
          <HubFaq faqs={d.faqs} heading="Power of sale in Ontario: common questions" />
        </div>

        <p className="mt-6 text-xs leading-relaxed text-muted-foreground">{SOURCE_LINE}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Cite as: PureProperty, &ldquo;{d.title}&rdquo;, {permalink.replace(/^https?:\/\/(www\.)?/, "")}. Free to quote with this attribution.{" "}
          <Link href="/data/for-journalists" className="underline hover:text-foreground">For journalists</Link>
        </p>

        <section className="mt-8">
          <h2 className="text-sm font-semibold text-muted-foreground">All editions</h2>
          <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm">
            {[...editions].reverse().map((e) =>
              e === d.edition ? (
                <span key={e} className="font-medium">{editionLabel(e)}</span>
              ) : (
                <Link key={e} href={posIndexPath(e)} className="underline hover:text-foreground">{editionLabel(e)}</Link>
              ),
            )}
          </p>
          <p className="mt-3 text-sm">
            <Link href="/power-of-sale" className="underline hover:text-foreground">Power of sale homes for sale now, by city →</Link>
          </p>
        </section>

        <div className="mt-8">
          <ListingComplianceNotice />
        </div>
      </div>
    </main>
  );
}
