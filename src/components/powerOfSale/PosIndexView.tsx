/**
 * One edition of the Ontario Power of Sale Index. Rendered by /data/power-of-sale-index
 * (the latest edition) and /data/power-of-sale-index/{YYYY-MM} (every edition, permanent
 * URL for citation). Server component; every figure is in the HTML (the chart is the only
 * client part, and its numbers are also in the text).
 *
 * Layout (2026-11-10 design pass): headline stat, three stat cards, the monthly chart, the
 * city bars against the Ontario line, a request card, the method, the FAQ, the cite box.
 */
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Gavel, Home, Quote } from "lucide-react";
import HubFaq from "@/components/seo/HubFaq";
import ListingComplianceNotice from "@/components/legal/ListingComplianceNotice";
import PosShareChart from "@/components/powerOfSale/PosShareChart";
import CopyCitation from "@/components/powerOfSale/CopyCitation";
import { posIndexPath, editionLabel, type PosIndexEdition } from "@/lib/data/posIndex";
import { SOURCE_LINE } from "@/lib/data/cityFacts";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");

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

const pct = (n: number) => `${n.toFixed(2)}%`;

/** "+52%" style relative change, with an arrow; neutral text colour (direction is in the arrow and the words). */
function Change({ now, before, unit = "a year earlier" }: { now: number; before: number | null; unit?: string }) {
  if (before == null || before <= 0) return null;
  const up = now >= before;
  const rel = Math.round(((now - before) / before) * 100);
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>
        <span className="font-semibold text-foreground">{up ? "Up" : "Down"} {Math.abs(rel)}%</span> from {pct(before)} {unit}
      </span>
    </span>
  );
}

function StatCard({ label, value, sub, children }: { label: string; value: string; sub: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col rounded-xl border border-border bg-card/60 p-4">
      <p className="terminal-font text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-bold tabular-nums text-foreground">{value}</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{sub}</p>
      {children && <div className="mt-2">{children}</div>}
    </div>
  );
}

export default function PosIndexView({ d, editions, isLatest }: { d: PosIndexEdition; editions: string[]; isLatest: boolean }) {
  const permalink = `${SITE_URL}${posIndexPath(d.edition)}`;
  const citation = `PureProperty, "${d.title}", ${permalink.replace(/^https?:\/\//, "")}`;
  const top = d.cities[0];
  const cityMax = Math.max(...d.cities.map((c) => Math.max(c.sharePct, c.prevSharePct ?? 0)), d.ontario12Pct ?? 0, 0.01) * 1.3; // room for the value label after the longest bar
  const ontX = d.ontario12Pct != null ? (d.ontario12Pct / cityMax) * 100 : null;

  return (
    <main className="min-h-app bg-background text-foreground">
      <div className="mx-auto max-w-4xl px-4 py-8">
        <nav className="mb-5 text-sm text-muted-foreground">
          <Link href="/data" className="hover:text-foreground">Data</Link>
          <span className="mx-2">/</span>
          <Link href={posIndexPath()} className="hover:text-foreground">Power of Sale Index</Link>
          <span className="mx-2">/</span>
          <span className="text-foreground">{d.label}</span>
        </nav>

        {/* ── Headline ─────────────────────────────────────────────────────────── */}
        <header className="overflow-hidden rounded-2xl border border-border bg-card/60">
          <div className="border-b border-border px-5 py-3 sm:px-7">
            <p className="terminal-font flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-orange-700 dark:text-orange-400">
              <Gavel className="h-3.5 w-3.5" aria-hidden="true" />
              Monthly index · {d.label}
              {isLatest && <span className="rounded border border-current px-1.5 py-px text-[9px]">Latest</span>}
            </p>
          </div>
          <div className="grid gap-6 px-5 py-6 sm:px-7 md:grid-cols-[1fr_auto] md:items-end">
            <div>
              <h1 className="text-2xl font-bold leading-tight sm:text-3xl">{d.title}</h1>
              <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground">{d.headline}</p>
            </div>
            <div className="md:text-right">
              <p className="text-5xl font-bold tabular-nums tracking-tight text-foreground sm:text-6xl">{pct(d.hero.sharePct)}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                of Ontario home sales, {d.hero.from.split(" ")[0]}–{d.label}
              </p>
              <div className="mt-2">
                <Change now={d.hero.sharePct} before={d.hero.prevSharePct} />
              </div>
            </div>
          </div>
        </header>

        {/* ── Stat cards ───────────────────────────────────────────────────────── */}
        <section className="mt-4 grid gap-3 sm:grid-cols-3" aria-label="Key figures">
          <StatCard
            label={`${d.label} alone`}
            value={pct(d.month.sharePct)}
            sub={`${d.month.pos} of ${d.month.sales.toLocaleString("en-CA")} sales. One month moves a lot by chance.`}
          >
            <Change now={d.month.sharePct} before={d.month.prevSharePct} unit={`in ${editionLabel(`${Number(d.edition.slice(0, 4)) - 1}${d.edition.slice(4)}`)}`} />
          </StatCard>
          {d.s2l ? (
            <StatCard
              label="Sale to asking price"
              value={`${d.s2l.pos.toFixed(1)}%`}
              sub={`Median for power-of-sale homes in ${d.label}, against ${d.s2l.other.toFixed(1)}% for other homes.`}
            />
          ) : (
            <StatCard label="Power-of-sale sales" value={d.hero.pos.toLocaleString("en-CA")} sub={`In Ontario, ${d.hero.from} to ${d.label}.`} />
          )}
          {top && (
            <StatCard
              label="Highest city share"
              value={`${top.city} ${pct(top.sharePct)}`}
              sub={`${top.pos} of ${top.sales.toLocaleString("en-CA")} sales, ${d.cityWindow}.`}
            >
              {top.prevSharePct != null && <Change now={top.sharePct} before={top.prevSharePct} unit="the 12 months before" />}
            </StatCard>
          )}
        </section>

        {/* ── Monthly chart ────────────────────────────────────────────────────── */}
        {d.series.length > 3 && (
          <section className="mt-8 rounded-2xl border border-border bg-card/40 p-5 sm:p-6" aria-labelledby="trend">
            <h2 id="trend" className="text-lg font-semibold">Share of Ontario home sales that were power of sale</h2>
            <div className="mt-3">
              <PosShareChart points={d.series} />
            </div>
            {/* The same numbers as a table, for screen readers and for copying. */}
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Show the numbers</summary>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[420px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-muted-foreground">
                      <th className="py-1.5 pr-3 font-medium">Month</th>
                      <th className="py-1.5 pr-3 text-right font-medium">Power of sale</th>
                      <th className="py-1.5 pr-3 text-right font-medium">All sales</th>
                      <th className="py-1.5 pr-3 text-right font-medium">Share</th>
                      <th className="py-1.5 text-right font-medium">3 months</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...d.series].reverse().map((p) => (
                      <tr key={p.edition} className="border-b border-border/60">
                        <td className="py-1.5 pr-3">{p.label}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{p.pos}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{p.sales.toLocaleString("en-CA")}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{pct(p.sharePct)}</td>
                        <td className="py-1.5 text-right tabular-nums">{p.avg3Pct != null ? pct(p.avg3Pct) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </section>
        )}

        {/* ── Cities ───────────────────────────────────────────────────────────── */}
        {d.cities.length > 0 && (
          <section className="mt-8 rounded-2xl border border-border bg-card/40 p-5 sm:p-6" aria-labelledby="cities">
            <h2 id="cities" className="text-lg font-semibold">By city, {d.cityWindow}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Share of each city&apos;s home sales that were power of sale, 12 months.
              {d.ontario12Pct != null && <> The dashed line is Ontario ({pct(d.ontario12Pct)}).</>}
            </p>
            <ul className="mt-5 space-y-3">
              {d.cities.map((c) => {
                const w = (c.sharePct / cityMax) * 100;
                const above = d.ontario12Pct != null && c.sharePct > d.ontario12Pct;
                return (
                  <li key={c.slug} className="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-3 sm:grid-cols-[9rem_minmax(0,1fr)_10rem]">
                    <Link href={`/power-of-sale/${c.slug}`} className="truncate text-sm font-medium underline-offset-4 hover:underline">
                      {c.city}
                    </Link>
                    <div className="relative h-6">
                      {ontX != null && (
                        <div className="absolute inset-y-0 border-l-2 border-dashed border-foreground/40" style={{ left: `${ontX}%` }} aria-hidden="true" />
                      )}
                      <div
                        className="absolute inset-y-1 left-0 rounded-r-[4px]"
                        style={{ width: `${Math.max(1.5, w)}%`, background: "#ea580c", opacity: above ? 0.95 : 0.55 }}
                        aria-hidden="true"
                      />
                      <span className="absolute inset-y-0 flex items-center" style={{ left: `${Math.max(1.5, w)}%` }}>
                        <span className="ml-1 rounded bg-card px-1 text-xs font-semibold tabular-nums">{pct(c.sharePct)}</span>
                      </span>
                    </div>
                    <p className="col-span-2 -mt-2 text-xs text-muted-foreground sm:col-span-1 sm:mt-0 sm:text-right">
                      {c.pos} of {c.sales.toLocaleString("en-CA")}
                      {c.prevSharePct != null && <> · was {pct(c.prevSharePct)}</>}
                    </p>
                  </li>
                );
              })}
            </ul>
            <p className="mt-4 text-xs text-muted-foreground">
              Cities with 500+ sales in the 12 months. &ldquo;Was&rdquo; is the 12 months before, shown when both periods have 10+ power-of-sale sales. Brighter bars are above the Ontario share.
            </p>
          </section>
        )}

        {/* ── Request card ─────────────────────────────────────────────────────── */}
        <section className="mt-8 grid gap-3 sm:grid-cols-2">
          <Link href="/power-of-sale" className="group flex items-start gap-3 rounded-2xl border border-border bg-card/60 p-5 transition-colors hover:border-orange-500/50">
            <Gavel className="mt-0.5 h-5 w-5 shrink-0 text-orange-700 dark:text-orange-400" aria-hidden="true" />
            <span>
              <span className="block font-semibold">Power-of-sale homes for sale now</span>
              <span className="mt-1 block text-sm text-muted-foreground">By city, lowest price first, updated daily.</span>
            </span>
          </Link>
          <Link href="/home-value" className="group flex items-start gap-3 rounded-2xl border border-emerald-600/40 bg-emerald-600/5 p-5 transition-colors hover:border-emerald-600/70">
            <Home className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
            <span>
              <span className="block font-semibold">Selling? Get a free price opinion</span>
              <span className="mt-1 block text-sm text-muted-foreground">A licensed Ontario REALTOR® reads the recent sales near your home and writes one for you.</span>
            </span>
          </Link>
        </section>

        <div className="mx-auto max-w-3xl">
          <section className="mt-10" aria-labelledby="method">
            <h2 id="method" className="text-lg font-semibold">How the index is made</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
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

          {/* ── Cite box ─────────────────────────────────────────────────────── */}
          <section className="mt-8 rounded-xl border border-border bg-card/60 p-4" aria-label="Cite this index">
            <div className="flex items-start gap-3">
              <Quote className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">Free to quote with attribution</p>
                <p className="mt-1 break-words text-xs text-muted-foreground">{citation}</p>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <CopyCitation text={citation} />
                  <Link href="/data/for-journalists" className="text-xs underline hover:text-foreground">For journalists: custom city figures</Link>
                </div>
              </div>
            </div>
          </section>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{SOURCE_LINE}</p>

          <section className="mt-8">
            <h2 className="text-sm font-semibold text-muted-foreground">All editions</h2>
            <div className="mt-2 flex flex-wrap gap-2">
              {[...editions].reverse().map((e) =>
                e === d.edition ? (
                  <span key={e} className="rounded-full border border-foreground/40 bg-foreground/5 px-3 py-1 text-xs font-medium">{editionLabel(e)}</span>
                ) : (
                  <Link key={e} href={posIndexPath(e)} className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground">
                    {editionLabel(e)}
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
