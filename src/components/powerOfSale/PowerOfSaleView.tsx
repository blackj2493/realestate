/**
 * The /power-of-sale page body, shared by the Ontario page (city = null) and the 15 city
 * pages: today's power-of-sale homes (IDX cards, cheapest first), the facts, what a power
 * of sale is, and FAQ answers. Server component. Aggregates + IDX listing cards only; the
 * compliance notice renders with the cards.
 *
 * Layout (2026-11 design pass, same style as the Power of Sale Index): headline count,
 * stat cards, the listings, what a power of sale means, the city bars (Ontario page),
 * request cards, FAQ, cite box. Every figure is also in the HTML text.
 */
import Link from "next/link";
import { BarChart3, Building2, FileSearch, Gavel } from "lucide-react";
import { PropertyCard } from "@/components/PropertyCard";
import { toCardData } from "@/lib/listings/listingCardData";
import type { ListingDocument } from "@/lib/typesense/client";
import HubFaq from "@/components/seo/HubFaq";
import ListingComplianceNotice from "@/components/legal/ListingComplianceNotice";
import type { PosFacts } from "@/lib/data/powerOfSale";
import { SOURCE_LINE } from "@/lib/data/cityFacts";
import { OUTLOOK_CITIES } from "@/lib/data/outlookCities";
import CityTopicLinks from "@/components/seo/CityTopicLinks";
import { Change, CiteBox, HeaderCard, LinkCard, PriceOpinionCard, StatCard } from "@/components/dataPage/parts";

export const powerOfSalePath = (slug?: string) => (slug ? `/power-of-sale/${slug}` : "/power-of-sale");

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");
const ORANGE = "#ea580c"; // validated with the dataviz validator on both page surfaces (#687)
const pct2 = (n: number) => `${n.toFixed(2)}%`;
const pct1 = (n: number) => `${n.toFixed(1)}%`;

function Dot() {
  return <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-orange-600 dark:bg-orange-400" />;
}

export default function PowerOfSaleView({
  city,
  slug,
  facts,
  listings,
  totalFound,
  cityShares,
}: {
  city: string | null;
  slug: string | null;
  facts: PosFacts;
  listings: ListingDocument[];
  totalFound: number;
  /** Ontario page only: each city's 12-month share, for the city list. */
  cityShares?: { city: string; slug: string; share: number | null; posSales: number | null }[];
}) {
  const place = city ?? "Ontario";
  const others = OUTLOOK_CITIES.filter((c) => c.slug !== slug);
  const st = facts.stats;
  const title = `Power of Sale Homes in ${place}`;
  const canonical = `${SITE_URL}${powerOfSalePath(slug ?? undefined)}`;
  const citation = `PureProperty, "${title}"${facts.updatedLabel ? `, updated ${facts.updatedLabel}` : ""}, ${canonical.replace(/^https?:\/\/(www\.)?/, "")}`;
  const shareFact = facts.facts.find((f) => f.id === "share")?.text ?? null;
  const ranked = (cityShares ?? []).filter((c) => c.share != null).sort((a, b) => (b.share as number) - (a.share as number));
  const shareMax = Math.max(...ranked.map((c) => c.share as number), st.ontarioSharePct ?? 0, 0.01) * 1.3;
  const ontX = st.ontarioSharePct != null ? (st.ontarioSharePct / shareMax) * 100 : null;

  return (
    <main className="min-h-app bg-background text-foreground">
      <div className="mx-auto max-w-[1400px] px-4 py-8">
        <nav className="mb-5 text-sm text-muted-foreground">
          <Link href="/" className="hover:text-foreground">Home</Link>
          <span className="mx-2">/</span>
          {city ? (
            <>
              <Link href={powerOfSalePath()} className="hover:text-foreground">Power of sale</Link>
              <span className="mx-2">/</span>
              <span className="text-foreground">{city}</span>
            </>
          ) : (
            <span className="text-foreground">Power of sale</span>
          )}
        </nav>

        <div className="mx-auto max-w-5xl">
          <HeaderCard
            tone="orange"
            Icon={Gavel}
            eyebrow={`Power of sale · ${place}`}
            title={title}
            lede={
              <>
                <p>{shareFact ?? `Homes for sale in ${place} that are listed as power of sale, and how power-of-sale homes sold against other homes.`}</p>
                {facts.updatedLabel && (
                  <p className="mt-2 text-sm">
                    Sales data updated <time dateTime={facts.updatedIso ?? undefined}>{facts.updatedLabel}</time> · listings updated daily
                  </p>
                )}
              </>
            }
            hero={totalFound.toLocaleString("en-CA")}
            heroSub={totalFound === 1 ? "home listed as power of sale now" : "homes listed as power of sale now"}
          />

          <section className="mt-4 grid gap-3 sm:grid-cols-3" aria-label="Key figures">
            {st.sharePct != null && (
              <StatCard
                label="Share of sales, 12 months"
                value={pct2(st.sharePct)}
                sub={`${facts.posSales ?? 0} of ${(st.sales ?? 0).toLocaleString("en-CA")} home sales in ${place}${
                  city && st.ontarioSharePct != null ? `. Ontario: ${pct2(st.ontarioSharePct)}` : ""
                }.`}
              >
                <Change now={st.sharePct} before={st.prevSharePct} fmt={pct2} unit="the 12 months before" />
              </StatCard>
            )}
            {st.s2l && (
              <StatCard
                label="Sale to asking price"
                value={pct1(st.s2l.pos)}
                sub={`Median for power-of-sale homes ${st.where}, against ${pct1(st.s2l.other)} for other homes.`}
              />
            )}
            {st.dom && (
              <StatCard
                label="Days to sell"
                value={`${st.dom.pos} days`}
                sub={`Median for power-of-sale homes ${st.where}, against ${st.dom.other} days for other homes.`}
              />
            )}
          </section>

          {facts.facts.length > 0 && (
            <section className="mt-6 rounded-2xl border border-border bg-card/40 p-5 sm:p-6" aria-labelledby="shows">
              <h2 id="shows" className="text-lg font-semibold">What the data shows</h2>
              <ul className="mt-3 space-y-2 text-sm leading-relaxed">
                {facts.facts.map((f) => (
                  <li key={f.id} className="flex gap-2">
                    <Dot />
                    <span>{f.text}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <section className="mt-10" aria-labelledby="now">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="now" className="text-lg font-semibold">For sale now, lowest price first</h2>
            <Link href="/properties?signal=power_of_sale" className="text-sm underline hover:text-foreground">
              See them on the map, with filters →
            </Link>
          </div>
          {listings.length > 0 ? (
            <div className="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {listings.map((doc) => (
                <PropertyCard key={doc.id} property={toCardData(doc)} showSaveButton={false} />
              ))}
            </div>
          ) : (
            <div className="mt-4 rounded-2xl border border-border bg-card/40 p-8 text-center text-muted-foreground">
              <Building2 className="mx-auto mb-3 h-8 w-8" aria-hidden="true" />
              <p>No power-of-sale homes are for sale in {place} right now.</p>
            </div>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            A home is listed here when its listing says it is a power of sale, foreclosure, bank-owned, court-ordered or receivership sale.
          </p>
        </section>

        <div className="mx-auto max-w-5xl">
          <section className="mt-10 rounded-2xl border border-border bg-card/40 p-5 sm:p-6" aria-labelledby="what">
            <h2 id="what" className="text-lg font-semibold">What a power of sale means for a buyer</h2>
            <ul className="mt-3 grid gap-3 text-sm leading-relaxed sm:grid-cols-2">
              {[
                "The lender sells the home because the owner stopped paying the mortgage. The lender, not the owner, sets the terms.",
                "The home is sold as is. The lender gives no promises about its condition, so get a home inspection.",
                "The owner can pay what they owe and stop the sale until it closes.",
                "The lender must try to get a fair market price, so the price is not automatically low.",
              ].map((t) => (
                <li key={t} className="flex gap-2 rounded-xl border border-border bg-background/60 p-3">
                  <Dot />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </section>

          {ranked.length > 0 && (
            <section className="mt-8 rounded-2xl border border-border bg-card/40 p-5 sm:p-6" aria-labelledby="cities">
              <h2 id="cities" className="text-lg font-semibold">By city, last 12 months</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Share of each city&apos;s home sales that were power of sale.
                {st.ontarioSharePct != null && <> The dashed line is Ontario ({pct2(st.ontarioSharePct)}).</>}
              </p>
              <ul className="mt-5 space-y-3">
                {ranked.map((c) => {
                  const w = ((c.share as number) / shareMax) * 100;
                  const above = st.ontarioSharePct != null && (c.share as number) > st.ontarioSharePct;
                  return (
                    <li key={c.slug} className="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-3 sm:grid-cols-[9rem_minmax(0,1fr)_10rem]">
                      <Link href={powerOfSalePath(c.slug)} className="truncate text-sm font-medium underline-offset-4 hover:underline">
                        {c.city}
                      </Link>
                      <div className="relative h-6">
                        {ontX != null && (
                          <div className="absolute inset-y-0 border-l-2 border-dashed border-foreground/40" style={{ left: `${ontX}%` }} aria-hidden="true" />
                        )}
                        <div
                          className="absolute inset-y-1 left-0 rounded-r-[4px]"
                          style={{ width: `${Math.max(1.5, w)}%`, background: ORANGE, opacity: above ? 0.95 : 0.55 }}
                          aria-hidden="true"
                        />
                        <span className="absolute inset-y-0 flex items-center" style={{ left: `${Math.max(1.5, w)}%` }}>
                          <span className="ml-1 rounded bg-card px-1 text-xs font-semibold tabular-nums">{pct2(c.share as number)}</span>
                        </span>
                      </div>
                      <p className="col-span-2 -mt-2 text-xs text-muted-foreground sm:col-span-1 sm:mt-0 sm:text-right">
                        {c.posSales != null ? `${c.posSales} power-of-sale sales` : ""}
                      </p>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-4 text-xs text-muted-foreground">Brighter bars are above the Ontario share.</p>
            </section>
          )}

          <section className="mt-8 grid gap-3 sm:grid-cols-3">
            <LinkCard href="/data/power-of-sale-index" Icon={BarChart3} title="Ontario Power of Sale Index" text="The share of sales that were power of sale, every month." />
            <LinkCard
              href="/data/findings/ontario-power-of-sale-discount"
              Icon={FileSearch}
              title="Are they cheaper?"
              text="Our research: how much less power-of-sale homes sell for than similar homes."
            />
            <PriceOpinionCard citySlug={slug} />
          </section>

          <div className="mx-auto max-w-3xl">
            <div className="mt-10">
              <HubFaq faqs={facts.faqs} heading={`Power of sale in ${place}: common questions`} />
            </div>

            {facts.updatedLabel && (
              <>
                <CiteBox citation={citation} />
                <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{SOURCE_LINE}</p>
              </>
            )}

            {slug && <CityTopicLinks citySlug={slug} current="power-of-sale" />}

            {city && (
              <section className="mt-8">
                <h2 className="text-sm font-semibold text-muted-foreground">Other cities</h2>
                <div className="mt-2 flex flex-wrap gap-2">
                  {others.map((c) => (
                    <Link
                      key={c.slug}
                      href={powerOfSalePath(c.slug)}
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

        <div className="mt-8">
          <ListingComplianceNotice />
        </div>
      </div>
    </main>
  );
}
