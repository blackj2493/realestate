/**
 * One edition of the monthly Ontario Housing Market Report. Rendered by /data/reports (the
 * latest edition, with the list of editions) and /data/reports/{YYYY-MM} (every edition, at a
 * permanent URL for citation). Server component: every figure is plain HTML text, read from
 * the frozen edition snapshot (src/lib/data/reportEditions.ts), so the page never changes.
 *
 * Layout (2026-11 design pass, same family as the Power of Sale Index): headline card with the
 * same-home price change, four stat cards, the key findings by reader, the city price-change
 * bars, the city table, the same-home quarters, the bank forecasts, power of sale, the trackers
 * behind the numbers, method, FAQ, cite box, all editions.
 */
import Link from "next/link";
import { CalendarDays, Gavel, LineChart, MapPin, Receipt, Tag, Timer, Users } from "lucide-react";
import HubFaq from "@/components/seo/HubFaq";
import ListingComplianceNotice from "@/components/legal/ListingComplianceNotice";
import BankForecasts from "@/components/data/BankForecasts";
import { CiteBox, LinkCard, PriceOpinionCard, StatCard } from "@/components/dataPage/parts";
import { SOURCE_LINE } from "@/lib/data/cityFacts";
import { outlookPath } from "@/lib/data/outlookCities";
import { editionLabel, reportPath, signedPct, usdK, type Audience, type ReportEdition } from "@/lib/data/monthlyReport";
import { forecastPct } from "@/lib/data/bankForecasts";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");
const ORG = { "@id": `${SITE_URL}/#organization` };

const dateLabel = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { month: "long", day: "numeric", year: "numeric", timeZone: "America/Toronto" });
const count = (n: number) => n.toLocaleString("en-CA");

/** The questions the edition answers, built from its own findings (no new figures). */
export function reportFaqs(d: ReportEdition): { q: string; a: string }[] {
  const f = (id: string) => d.findings.find((x) => x.id === id)?.text ?? null;
  const faqs: { q: string; a: string }[] = [];
  if (f("same_home")) faqs.push({ q: `Are house prices dropping in Ontario?`, a: f("same_home")! });
  const r = d.forecasts;
  if (r) {
    faqs.push({
      q: `What is the Ontario housing market forecast for ${r.year}?`,
      a: `PureProperty does not forecast prices. At the time of this report, the ${r.forecasts.length} published forecasts for Ontario (${r.forecasts.map((x) => x.source).join(", ")}) expected home prices to change by ${forecastPct(r.priceLow)} to ${forecastPct(r.priceHigh)} in ${r.year}, and home sales by ${forecastPct(r.salesLow)} to ${forecastPct(r.salesHigh)}.`,
    });
  }
  if (f("room")) faqs.push({ q: "Is it a good time to buy a house in Ontario?", a: `That depends on the home and on your plans. The data shows how much room buyers have now: ${f("room")}` });
  if (f("sales")) faqs.push({ q: "Is it a good time to sell a house in Ontario?", a: `${f("sales")} A REALTOR® can give you a price opinion for your own home.` });
  faqs.push({
    q: "How often is this report published?",
    a: "Every month, near the end of the month. Each edition stays at its own address and does not change, so a figure you quote keeps its source. The city pages linked below update every night.",
  });
  return faqs;
}

export function reportJsonLd(d: ReportEdition, canonical: string) {
  const measures = [
    d.sameHome && { "@type": "PropertyValue", name: `Same-home price change, Ontario, ${d.sameHome.window}`, value: d.sameHome.pct, unitText: "percent" },
    d.combined && { "@type": "PropertyValue", name: `Change in number of sales, ${d.combined.cities} cities, ${d.span} vs a year earlier`, value: d.combined.salesYoYPct, unitText: "percent" },
    d.combined?.underAskPct != null && { "@type": "PropertyValue", name: "Share of homes sold below the first asking price, last 12 months", value: d.combined.underAskPct, unitText: "percent" },
    d.combined?.cutPct != null && { "@type": "PropertyValue", name: "Share of homes for sale with a price cut", value: d.combined.cutPct, unitText: "percent" },
    d.pos && { "@type": "PropertyValue", name: `Power-of-sale share of Ontario home sales, ${d.pos.from} to ${d.pos.to}`, value: d.pos.sharePct, unitText: "percent" },
  ].filter(Boolean);
  return [
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
        { "@type": "ListItem", position: 2, name: "Data", item: `${SITE_URL}/data` },
        { "@type": "ListItem", position: 3, name: "Monthly reports", item: `${SITE_URL}${reportPath()}` },
        { "@type": "ListItem", position: 4, name: d.label, item: `${SITE_URL}${reportPath(d.edition)}` },
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: d.title,
      description: d.summary,
      url: canonical,
      mainEntityOfPage: canonical,
      datePublished: d.publishedAt,
      dateModified: d.publishedAt,
      author: ORG,
      publisher: ORG,
      about: { "@type": "Place", name: "Ontario, Canada" },
    },
    {
      "@context": "https://schema.org",
      "@type": "Dataset",
      name: d.title,
      description: d.findings.map((f) => f.text).join(" ").slice(0, 4900),
      url: canonical,
      datePublished: d.publishedAt,
      isAccessibleForFree: true,
      creator: ORG,
      publisher: ORG,
      spatialCoverage: { "@type": "Place", name: "Ontario, Canada" },
      measurementTechnique: SOURCE_LINE,
      variableMeasured: measures,
    },
  ];
}

const AUDIENCE_STYLE: Record<Audience, string> = {
  Buyers: "border-sky-600/40 text-sky-800 dark:text-sky-300",
  Sellers: "border-emerald-600/40 text-emerald-800 dark:text-emerald-300",
  Owners: "border-amber-600/40 text-amber-800 dark:text-amber-300",
};

/** Price change by city: bars from a zero line, one hue; the sign is in the side and the label. */
function PriceBars({ d }: { d: ReportEdition }) {
  const rows = d.cities.filter((c) => c.priceYoYPct != null).sort((a, b) => (a.priceYoYPct as number) - (b.priceYoYPct as number));
  const max = Math.max(...rows.map((c) => Math.abs(c.priceYoYPct as number)), 1);
  const neg = Math.max(...rows.map((c) => Math.max(0, -(c.priceYoYPct as number))), 0);
  const pos = Math.max(...rows.map((c) => Math.max(0, c.priceYoYPct as number)), 0);
  // The zero line sits where the widest drop ends, with room for labels on both sides.
  const zero = neg + pos > 0 ? (neg / (neg + pos)) * 78 + 11 : 50;
  return (
    <ul className="mt-5 space-y-2.5">
      {rows.map((c) => {
        const v = c.priceYoYPct as number;
        const w = (Math.abs(v) / max) * (v < 0 ? zero - 11 : 89 - zero);
        return (
          <li key={c.slug} className="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-3 sm:grid-cols-[9rem_minmax(0,1fr)]">
            <Link href={outlookPath(c.slug)} className="truncate text-sm underline-offset-4 hover:underline">
              {c.city}
            </Link>
            <div className="relative h-6">
              <div className="absolute inset-y-0 border-l border-foreground/40" style={{ left: `${zero}%` }} aria-hidden="true" />
              <div
                className={v < 0 ? "absolute inset-y-1 rounded-l-[4px]" : "absolute inset-y-1 rounded-r-[4px]"}
                style={{ left: v < 0 ? `${zero - w}%` : `${zero}%`, width: `${Math.max(0.8, w)}%`, background: "#0d9488" }}
                aria-hidden="true"
              />
              <span
                className="absolute inset-y-0 flex items-center text-xs font-semibold tabular-nums"
                style={v < 0 ? { right: `${100 - (zero - w)}%`, paddingRight: 4 } : { left: `${zero + w}%`, paddingLeft: 4 }}
              >
                {signedPct(v)}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export default function ReportView({ d, editions, isLatest }: { d: ReportEdition; editions: ReportEdition[]; isLatest: boolean }) {
  const permalink = `${SITE_URL}${reportPath(d.edition)}`;
  const citation = `PureProperty, "${d.title}", ${permalink.replace(/^https?:\/\//, "")}`;
  const c = d.combined;
  const sh = d.sameHome;

  return (
    <main className="min-h-app bg-background text-foreground">
      <div className="mx-auto max-w-4xl px-4 py-8">
        <nav className="mb-5 text-sm text-muted-foreground">
          <Link href="/data" className="hover:text-foreground">Data</Link>
          <span className="mx-2">/</span>
          <Link href={reportPath()} className="hover:text-foreground">Monthly reports</Link>
          <span className="mx-2">/</span>
          <span className="text-foreground">{d.label}</span>
        </nav>

        {/* ── Headline ─────────────────────────────────────────────────────────── */}
        <header className="overflow-hidden rounded-2xl border border-border bg-card/60">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3 sm:px-7">
            <p className="terminal-font flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-teal-700 dark:text-teal-400">
              <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
              Monthly report · {d.label}
              {isLatest && <span className="rounded border border-current px-1.5 py-px text-[9px]">Latest</span>}
            </p>
            <p className="text-xs text-muted-foreground">
              Published {dateLabel(d.publishedAt)} · Sales to the end of {d.lastMonth}
            </p>
          </div>
          <div className="grid gap-6 px-5 py-6 sm:px-7 md:grid-cols-[1fr_auto] md:items-end">
            <div>
              <h1 className="text-2xl font-bold leading-tight sm:text-3xl">{d.title}</h1>
              <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground">{d.summary}</p>
            </div>
            {sh && (
              <div className="md:text-right">
                <p className="text-5xl font-bold tabular-nums tracking-tight text-foreground sm:text-6xl">{signedPct(sh.pct)}</p>
                <p className="mt-1 max-w-[16rem] text-sm text-muted-foreground md:ml-auto">
                  Ontario prices against similar homes a year earlier, {sh.window}
                </p>
              </div>
            )}
          </div>
        </header>

        {/* ── Stat cards ───────────────────────────────────────────────────────── */}
        <section className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Key figures">
          {c && (
            <StatCard label={`Sales, ${d.span.replace(/ \d{4}$/, "")}`} value={signedPct(c.salesYoYPct, 0)} sub={`${count(c.sales3m)} homes sold in ${c.cities} cities, against ${count(c.salesBefore)} a year earlier.`} />
          )}
          {c?.underAskPct != null && <StatCard label="Sold under first asking" value={`${Math.round(c.underAskPct)}%`} sub={`Of homes sold in the ${c.cities} cities in the last 12 months.`} />}
          {c?.cutPct != null && <StatCard label="Price cut, for sale now" value={`${Math.round(c.cutPct)}%`} sub={`Of the ${count(c.forSale ?? 0)} homes for sale in the ${c.cities} cities on ${dateLabel(d.dataAsOf)}.`} />}
          {d.pos && (
            <StatCard
              label="Power of sale"
              value={`${d.pos.sharePct.toFixed(2)}%`}
              sub={`Of Ontario home sales, ${d.pos.from} to ${d.pos.to}${d.pos.prevSharePct != null ? `, against ${d.pos.prevSharePct.toFixed(2)}% a year earlier` : ""}.`}
            />
          )}
        </section>

        {/* ── Key findings ─────────────────────────────────────────────────────── */}
        <section className="mt-8" aria-labelledby="findings">
          <h2 id="findings" className="text-lg font-semibold">Key findings for {d.label}</h2>
          <ol className="mt-3 grid gap-3 sm:grid-cols-2">
            {d.findings.map((f) => (
              <li key={f.id} className="rounded-xl border border-border bg-card/40 p-4">
                <span className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold ${AUDIENCE_STYLE[f.audience]}`}>For {f.audience.toLowerCase()}</span>
                <h3 className="mt-2 font-semibold">{f.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{f.text}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* ── Cities ───────────────────────────────────────────────────────────── */}
        <section className="mt-8 rounded-2xl border border-border bg-card/40 p-5 sm:p-6" aria-labelledby="city-prices">
          <h2 id="city-prices" className="text-lg font-semibold">Median sale price by city, {d.span}, against a year earlier</h2>
          <p className="mt-1 text-sm text-muted-foreground">All home types. The median moves with the mix of homes sold, so a small change can come from more condos or more houses selling.</p>
          <PriceBars d={d} />
        </section>

        <section className="mt-8" aria-labelledby="city-table">
          <h2 id="city-table" className="text-lg font-semibold">The {d.cities.length} cities in numbers</h2>
          <div className="mt-3 overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-card/60">
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="px-3 py-2 font-medium">City</th>
                  <th className="px-3 py-2 text-right font-medium">Median price</th>
                  <th className="px-3 py-2 text-right font-medium">vs year earlier</th>
                  <th className="px-3 py-2 text-right font-medium">Sales</th>
                  <th className="px-3 py-2 text-right font-medium">vs year earlier</th>
                  <th className="px-3 py-2 text-right font-medium">Sale to asking</th>
                  <th className="px-3 py-2 text-right font-medium">Days to sell</th>
                  <th className="px-3 py-2 text-right font-medium">Price cut now</th>
                </tr>
              </thead>
              <tbody>
                {d.cities.map((x) => (
                  <tr key={x.slug} className="border-b border-border/60 last:border-0">
                    <td className="px-3 py-2">
                      <Link href={outlookPath(x.slug)} className="underline-offset-4 hover:underline">{x.city}</Link>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{x.medianPrice != null ? usdK(x.medianPrice) : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{x.priceYoYPct != null ? signedPct(x.priceYoYPct) : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{x.sales3m != null ? count(x.sales3m) : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{x.salesYoYPct != null ? signedPct(x.salesYoYPct, 0) : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{x.saleToAskPct != null ? `${x.saleToAskPct.toFixed(1)}%` : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{x.medianDom ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{x.cutPct != null ? `${x.cutPct}%` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Median price, sales and sale to asking: {d.span}, against the same months a year earlier. Sale to asking is the average sale price as a share of the final asking
            price. Days to sell: median days on the market for homes sold in the last 12 months. Price cut now: share of homes for sale on {dateLabel(d.dataAsOf)} with a
            lower asking price than when listed. Ordered by number of sales.
          </p>
        </section>

        {/* ── Same-home change ─────────────────────────────────────────────────── */}
        {sh && (
          <section className="mt-8 rounded-2xl border border-border bg-card/40 p-5 sm:p-6" aria-labelledby="same-home">
            <h2 id="same-home" className="text-lg font-semibold">Ontario prices, same homes against a year earlier</h2>
            <p className="mt-2 text-sm leading-relaxed">
              Each sale is compared with similar homes in the same community a year earlier: same home type, bedrooms and size. A change in the mix of homes sold does not move
              this figure. From {sh.window}, prices were {signedPct(sh.pct)} (95% range {signedPct(sh.lo)} to {signedPct(sh.hi)}). In {sh.shareDownPct}% of the groups of similar homes,
              the median was lower than a year earlier.
            </p>
            {sh.quarters.length > 1 && (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[360px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-muted-foreground">
                      <th className="py-1.5 pr-3 font-medium">Quarter</th>
                      <th className="py-1.5 text-right font-medium">Against the same quarter a year earlier</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sh.quarters.map((q) => (
                      <tr key={q.label} className="border-b border-border/60">
                        <td className="py-1.5 pr-3">{q.label}</td>
                        <td className="py-1.5 text-right tabular-nums">{signedPct(q.pct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-3 text-sm">
              <Link href="/data/price-change" className="underline hover:text-foreground">Same-home price change by city →</Link>
            </p>
          </section>
        )}

        {d.forecasts && <BankForecasts year={d.forecasts.year} range={d.forecasts} />}

        {/* ── Where the numbers come from ─────────────────────────────────────── */}
        <section className="mt-8" aria-labelledby="trackers">
          <h2 id="trackers" className="text-lg font-semibold">The live data behind this report</h2>
          <p className="mt-1 text-sm text-muted-foreground">These pages update every night. This report keeps the figures as they were in {d.label}.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <LinkCard href="/data/housing-market" Icon={LineChart} title="Housing market by city" text="Prices, sales and sale to asking against a year earlier, for each city." />
            <LinkCard href="/data/sold-prices" Icon={MapPin} title="Sold prices by city" text="Median sold prices by home type, bedrooms and community." />
            <LinkCard href="/data/price-cuts" Icon={Tag} title="Price cuts" text="How many sellers cut their price, and by how much." />
            <LinkCard href="/data/days-on-market" Icon={Timer} title="Days on market" text="How long homes take to sell, by city." />
            <LinkCard href="/data/power-of-sale-index" Icon={Gavel} title="Power of Sale Index" text="The monthly share of Ontario sales that were power of sale." />
            <LinkCard href="/data/property-tax" Icon={Receipt} title="Property tax by city" text="What owners pay, from the tax bill on each sale." />
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <PriceOpinionCard citySlug={null} />
            <LinkCard href="/data/for-journalists" Icon={Users} title="For journalists" text="Custom city figures and charts, usually within one business day." />
          </div>
        </section>

        <div className="mx-auto max-w-3xl">
          <section className="mt-10" aria-labelledby="method">
            <h2 id="method" className="text-lg font-semibold">How this report is made</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              All figures are totals, medians and shares of MLS® sales and listings in Ontario. No figure describes a single home. City figures cover {d.span}; a city&apos;s change in
              sales is shown when it has 90 or more sales in each period. Sales are dated by the day the deal was made. Late-reported sales can raise the newest month a little
              in the following weeks; this edition keeps the figures as they were on {dateLabel(d.dataAsOf)}.
            </p>
            <p className="mt-2 text-sm">
              <Link href="/data/methodology" className="underline hover:text-foreground">Methodology: our sources and how each measure is calculated →</Link>
            </p>
          </section>

          <div className="mt-8">
            <HubFaq faqs={reportFaqs(d)} heading={`Ontario housing market, ${d.label}: common questions`} />
          </div>

          <CiteBox citation={citation} />
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{SOURCE_LINE.replace(", refreshed nightly", "")}</p>

          <section className="mt-8">
            <h2 className="text-sm font-semibold text-muted-foreground">All editions</h2>
            <div className="mt-2 flex flex-wrap gap-2">
              {[...editions].reverse().map((e) =>
                e.edition === d.edition ? (
                  <span key={e.edition} className="rounded-full border border-foreground/40 bg-foreground/5 px-3 py-1 text-xs font-medium">{editionLabel(e.edition)}</span>
                ) : (
                  <Link key={e.edition} href={reportPath(e.edition)} className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground">
                    {editionLabel(e.edition)}
                  </Link>
                ),
              )}
            </div>
          </section>

          <div className="mt-8">
            <ListingComplianceNotice />
          </div>
        </div>
      </div>
    </main>
  );
}
