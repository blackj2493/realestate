/**
 * The /house-not-selling page body, shared by the Ontario page (city = null) and the 15
 * city pages. Server component: the facts as sentences (quotable), two small static charts
 * (each bar carries its value as a label, so nothing is colour-only), three checks, the
 * second-opinion form, the city list, FAQ. Aggregates only.
 *
 * Colours: sold = emerald-600 #059669; did not sell = orange #c2410c light / #ea580c dark.
 * Both pairs pass dataviz validate_palette.js on #ffffff and #020617. Text stays in text tokens.
 */
import Link from "next/link";
import CityTopicLinks from "@/components/seo/CityTopicLinks";
import { Camera, CircleSlash, Scale, Wrench } from "lucide-react";
import { CiteBox, HeaderCard, StatCard } from "@/components/dataPage/parts";
import { SOURCE_LINE } from "@/lib/data/cityFacts";
import HubFaq from "@/components/seo/HubFaq";
import type { NotSellingFacts } from "@/lib/data/notSelling";
import { OUTLOOK_CITIES, outlookPath } from "@/lib/data/outlookCities";
import { homeValuePath, HOME_VALUE_CITIES } from "@/lib/homeValue/content";
import NotSellingRequestCard from "./NotSellingRequestCard";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");

export const notSellingPath = (slug?: string) => (slug ? `/house-not-selling/${slug}` : "/house-not-selling");

const SOLD = "fill-[#059669]";
const UNSOLD = "fill-[#c2410c] dark:fill-[#ea580c]";
const Dot = () => <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-600 dark:bg-emerald-400" />;

/** Sold vs did-not-sell split, one bar. */
function SplitBar({ sold, unsold }: { sold: number; unsold: number }) {
  const total = sold + unsold;
  const w = 600;
  const ws = Math.max(0, (sold / total) * w - 1);
  const pu = Math.round((unsold / total) * 100);
  return (
    <svg viewBox={`0 0 ${w} 46`} className="mt-3 h-auto w-full" role="img" aria-label={`${100 - pu}% sold, ${pu}% did not sell`}>
      <rect x="0" y="0" width={ws} height="18" rx="4" className={SOLD} />
      <rect x={ws + 2} y="0" width={Math.max(0, w - ws - 2)} height="18" rx="4" className={UNSOLD} />
      <text x="0" y="38" className="fill-foreground text-[13px] font-medium">
        Sold {100 - pu}%
      </text>
      <text x={w} y="38" textAnchor="end" className="fill-foreground text-[13px] font-medium">
        Did not sell {pu}%
      </text>
    </svg>
  );
}

/** Two horizontal bars from a zero line, with the value written at the end. */
function PairBars({ title, unsold, sold, unit }: { title: string; unsold: number; sold: number; unit: "gap" | "share" }) {
  const W = 600;
  const LABEL = 120;
  const max = Math.max(Math.abs(unsold), Math.abs(sold), unit === "gap" ? 5 : 10);
  const scale = (W - LABEL - 70) / max;
  const fmt = (v: number) => (unit === "gap" ? `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(0)}%` : `${v.toFixed(0)}%`);
  const bar = (v: number, y: number, cls: string, label: string) => {
    const len = Math.max(2, Math.abs(v) * scale);
    return (
      <g key={label}>
        <text x={LABEL - 10} y={y + 14} textAnchor="end" className="fill-muted-foreground text-[13px]">
          {label}
        </text>
        <path d={`M${LABEL},${y} h${len - 4} q4,0 4,4 v12 q0,4 -4,4 h-${len - 4} z`} className={cls} />
        <text x={LABEL + len + 8} y={y + 14} className="fill-foreground text-[13px] font-semibold">
          {fmt(v)}
        </text>
      </g>
    );
  };
  return (
    <figure className="min-w-0">
      <figcaption className="text-sm font-medium text-foreground">{title}</figcaption>
      <svg viewBox={`0 0 ${W} 74`} className="mt-2 h-auto w-full" role="img" aria-label={`${title}: did not sell ${fmt(unsold)}, sold ${fmt(sold)}`}>
        <line x1={LABEL} x2={LABEL} y1="0" y2="74" className="stroke-border" strokeWidth={1} />
        {bar(unsold, 8, UNSOLD, "Did not sell")}
        {bar(sold, 44, SOLD, "Sold")}
      </svg>
    </figure>
  );
}

const CHECKS = [
  {
    icon: Scale,
    title: "Compare your price with real sales",
    text: "Look at what similar homes near you sold for in the last few months, not at what other homes ask. This is where most of the gap shows.",
  },
  {
    icon: Camera,
    title: "Check the photos and the description",
    text: "Most buyers see the photos first. Dark, few or old photos lose showings before anyone sees the price.",
  },
  {
    icon: Wrench,
    title: "Fix what buyers see in a showing",
    text: "Small repairs, a clean and empty space, and a fresh coat of paint cost little next to a price cut.",
  },
];

export default function NotSellingView({
  city,
  slug,
  facts,
  cityRows,
}: {
  city: string | null;
  slug: string | null;
  facts: NotSellingFacts;
  /** Ontario page only: each city's unsold share, for the city list. */
  cityRows?: { city: string; slug: string; unsoldShare: number | null; unsold: number | null }[];
}) {
  const place = city ?? "Ontario";
  const others = OUTLOOK_CITIES.filter((c) => c.slug !== slug);
  const ch = facts.chart;
  const hasHomeValue = slug != null && HOME_VALUE_CITIES.some((c) => c.slug === slug);
  const title = `Why Is My House Not Selling in ${place}?`;
  const canonical = `${SITE_URL}${notSellingPath(slug ?? undefined)}`;
  const citation = `PureProperty, "${title}"${facts.updatedLabel ? `, updated ${facts.updatedLabel}` : ""}, ${canonical.replace(/^https?:\/\/(www\.)?/, "")}`;
  const fmtGap = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(0)}%`;

  return (
    <main className="min-h-app bg-background text-foreground">
      <div className="mx-auto max-w-4xl px-4 py-8">
        <nav className="mb-5 text-sm text-muted-foreground">
          <Link href="/" className="hover:text-foreground">Home</Link>
          <span className="mx-2">/</span>
          {city ? (
            <>
              <Link href={notSellingPath()} className="hover:text-foreground">House not selling</Link>
              <span className="mx-2">/</span>
              <span className="text-foreground">{city}</span>
            </>
          ) : (
            <span className="text-foreground">House not selling</span>
          )}
        </nav>

        <HeaderCard
          tone="orange"
          Icon={CircleSlash}
          eyebrow={`Homes not selling · ${place}`}
          title={title}
          lede={
            <>
              <p>{facts.facts.find((f) => f.id === "share")?.text ?? facts.summary}</p>
              {facts.updatedLabel && (
                <p className="mt-2 text-sm">
                  MLS® sales and listings, last 12 months · Updated <time dateTime={facts.updatedIso ?? undefined}>{facts.updatedLabel}</time>
                </p>
              )}
            </>
          }
          hero={facts.unsoldShare != null ? `${Math.round(facts.unsoldShare)}%` : null}
          heroSub="of the homes that came off the market did not sell"
        />

        {(ch || facts.unsold != null) && (
          <section className="mt-4 grid gap-3 sm:grid-cols-3" aria-label="Key figures">
            {facts.unsold != null && facts.sold != null && (
              <StatCard
                label="Did not sell"
                value={facts.unsold.toLocaleString("en-CA")}
                sub={`Homes that came off the market unsold in 12 months, against ${facts.sold.toLocaleString("en-CA")} that sold.`}
              />
            )}
            {ch && (
              <StatCard
                label="Asking above similar homes"
                value={fmtGap(ch.unsoldGap)}
                sub={`Median for the homes that did not sell, against ${fmtGap(ch.soldGap)} for the homes that sold${ch.basis !== place ? ` (${ch.basis})` : ""}.`}
              />
            )}
            {ch && ch.unsoldOver10 != null && ch.soldOver10 != null && (
              <StatCard
                label="Asked 10%+ above"
                value={`${ch.unsoldOver10.toFixed(0)}%`}
                sub={`Of the homes that did not sell, against ${ch.soldOver10.toFixed(0)}% of the homes that sold.`}
              />
            )}
          </section>
        )}

        {facts.sold != null && facts.unsold != null && facts.sold + facts.unsold > 0 && (
          <section className="mt-8 rounded-2xl border border-border bg-card/40 p-5 sm:p-6" aria-labelledby="split">
            <h2 id="split" className="text-base font-semibold">
              Homes that came off the market in {place}, last 12 months
            </h2>
            <SplitBar sold={facts.sold} unsold={facts.unsold} />
            <p className="mt-1 text-xs text-muted-foreground">
              {facts.sold.toLocaleString("en-CA")} sold · {facts.unsold.toLocaleString("en-CA")} came off the market unsold and are not for sale again now
            </p>
          </section>
        )}

        {ch && (
          <section className="mt-4 rounded-2xl border border-border bg-card/40 p-5 sm:p-6" aria-labelledby="gap">
            <h2 id="gap" className="text-base font-semibold">The asking price is the clearest difference</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Asking price compared with the median sale price of similar homes (same neighbourhood, home type and bedrooms)
              {ch.basis !== place ? `, across ${ch.basis}` : ""}.
            </p>
            <div className="mt-4 grid gap-5">
              <PairBars title="Median asking price above similar homes" unsold={ch.unsoldGap} sold={ch.soldGap} unit="gap" />
              {ch.unsoldOver10 != null && ch.soldOver10 != null && (
                <PairBars title="Share asking more than 10% above similar homes" unsold={ch.unsoldOver10} sold={ch.soldOver10} unit="share" />
              )}
            </div>
          </section>
        )}

        {facts.facts.length > 0 && (
          <section className="mt-8 rounded-2xl border border-border bg-card/40 p-5 sm:p-6" aria-labelledby="facts">
            <h2 id="facts" className="text-lg font-semibold">What the numbers show</h2>
            <ul className="mt-3 space-y-2 text-sm leading-relaxed">
              {facts.facts.map((f) => (
                <li key={f.id} className="flex gap-2">
                  <Dot />
                  <span>{f.text}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              &ldquo;Similar homes&rdquo; share the neighbourhood, type and bedrooms, but size and condition still differ. The numbers show what
              the unsold homes had in common, not proof of why each one did not sell.
            </p>
          </section>
        )}

        <section className="mt-8" aria-labelledby="checks">
          <h2 id="checks" className="text-lg font-semibold">Three things to check before you cut the price</h2>
          <ol className="mt-3 grid gap-3 sm:grid-cols-3">
            {CHECKS.map((c, i) => (
              <li key={c.title} className="rounded-xl border border-border bg-card/40 p-4">
                <div className="flex items-center gap-2">
                  <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-white">
                    <c.icon className="h-4 w-4" />
                  </span>
                  <span className="text-xs font-semibold text-muted-foreground">Check {i + 1}</span>
                </div>
                <p className="mt-2 text-sm font-semibold">{c.title}</p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{c.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <div className="mt-8">
          <NotSellingRequestCard city={city} />
        </div>

        {cityRows && cityRows.length > 0 && (
          <section className="mt-10 rounded-2xl border border-border bg-card/40 p-5 sm:p-6" aria-labelledby="cities">
            <h2 id="cities" className="text-lg font-semibold">By city: share of homes that did not sell</h2>
            <ul className="mt-3 divide-y divide-border text-sm">
              {cityRows.map((c) => (
                <li key={c.slug} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-2 sm:grid-cols-[200px_minmax(0,1fr)_auto]">
                  <Link href={notSellingPath(c.slug)} className="underline hover:text-foreground">
                    {c.city}
                  </Link>
                  <span aria-hidden="true" className="hidden h-2 rounded-full bg-muted sm:block">
                    {c.unsoldShare != null && (
                      <span className="block h-2 rounded-full bg-[#c2410c] dark:bg-[#ea580c]" style={{ width: `${Math.min(100, c.unsoldShare)}%` }} />
                    )}
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    {c.unsoldShare != null && c.unsold != null ? `${Math.round(c.unsoldShare)}% (${c.unsold.toLocaleString("en-CA")} homes)` : "—"}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="mx-auto max-w-3xl">
        <div className="mt-10">
          <HubFaq faqs={facts.faqs} heading={`House not selling in ${place}: common questions`} />
        </div>

        {facts.updatedLabel && (
          <>
            <CiteBox citation={citation} />
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{SOURCE_LINE}</p>
          </>
        )}

        <section className="mt-8 text-sm">
          <h2 className="text-sm font-semibold text-muted-foreground">More for sellers</h2>
          <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            <Link href={hasHomeValue && slug ? homeValuePath(slug) : homeValuePath()} className="underline hover:text-foreground">
              What is my home worth{city ? ` in ${city}` : ""}?
            </Link>
            {slug && (
              <Link href={outlookPath(slug)} className="underline hover:text-foreground">
                {city} housing market, month by month
              </Link>
            )}
          </p>
        </section>

        {slug && <CityTopicLinks citySlug={slug} current="not-selling" className="mt-6" />}

        {city && (
          <section className="mt-6">
            <h2 className="text-sm font-semibold text-muted-foreground">Other cities</h2>
            <div className="mt-2 flex flex-wrap gap-2">
              {others.map((c) => (
                <Link
                  key={c.slug}
                  href={notSellingPath(c.slug)}
                  className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
                >
                  {c.city}
                </Link>
              ))}
            </div>
          </section>
        )}
        </div>
      </div>
    </main>
  );
}
