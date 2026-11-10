/**
 * The /power-of-sale page body, shared by the Ontario page (city = null) and the 15 city
 * pages: today's power-of-sale homes (IDX cards, cheapest first), the facts, what a power
 * of sale is, and FAQ answers. Server component. Aggregates + IDX listing cards only; the
 * compliance notice renders with the cards.
 */
import Link from "next/link";
import { Building2 } from "lucide-react";
import { PropertyCard } from "@/components/PropertyCard";
import { toCardData } from "@/lib/listings/listingCardData";
import type { ListingDocument } from "@/lib/typesense/client";
import HubFaq from "@/components/seo/HubFaq";
import ListingComplianceNotice from "@/components/legal/ListingComplianceNotice";
import type { PosFacts } from "@/lib/data/powerOfSale";
import { OUTLOOK_CITIES } from "@/lib/data/outlookCities";
import CityTopicLinks from "@/components/seo/CityTopicLinks";

export const powerOfSalePath = (slug?: string) => (slug ? `/power-of-sale/${slug}` : "/power-of-sale");

const Dot = () => <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-600 dark:bg-emerald-400" />;

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

  return (
    <main className="min-h-app bg-background text-foreground">
      <div className="mx-auto max-w-[1400px] px-4 py-8">
        <nav className="mb-4 text-sm text-muted-foreground">
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

        <div className="max-w-3xl">
          <h1 className="text-2xl font-bold sm:text-3xl">Power of Sale Homes in {place}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {totalFound.toLocaleString("en-CA")} for sale now
            {facts.updatedLabel && (
              <>
                {" "}· Sales data updated <time dateTime={facts.updatedIso ?? undefined}>{facts.updatedLabel}</time>
              </>
            )}
          </p>

          {facts.facts.length > 0 && (
            <ul className="mt-5 space-y-2 text-sm leading-relaxed">
              {facts.facts.map((f) => (
                <li key={f.id} className="flex gap-2">
                  <Dot />
                  <span>{f.text}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <section className="mt-8" aria-labelledby="now">
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
            <div className="mt-4 rounded-lg border border-border bg-card/40 p-8 text-center text-muted-foreground">
              <Building2 className="mx-auto mb-3 h-8 w-8" />
              <p>No power-of-sale homes are for sale in {place} right now.</p>
            </div>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            A home is listed here when its listing says it is a power of sale, foreclosure, bank-owned, court-ordered or receivership sale.
          </p>
        </section>

        <div className="max-w-3xl">
          <section className="mt-10" aria-labelledby="what">
            <h2 id="what" className="text-lg font-semibold">What a power of sale means for a buyer</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed">
              <li>The lender sells the home because the owner stopped paying the mortgage. The lender, not the owner, sets the terms.</li>
              <li>The home is sold as is. The lender gives no promises about its condition, so get a home inspection.</li>
              <li>The owner can pay what they owe and stop the sale until it closes.</li>
              <li>The lender must try to get a fair market price, so the price is not automatically low.</li>
            </ul>
            <p className="mt-3 text-sm">
              <Link href="/data/findings/ontario-power-of-sale-discount" className="underline hover:text-foreground">
                Our research: how much less power-of-sale homes sell for than similar homes →
              </Link>
            </p>
          </section>

          {cityShares && cityShares.length > 0 && (
            <section className="mt-10" aria-labelledby="cities">
              <h2 id="cities" className="text-lg font-semibold">By city, last 12 months</h2>
              <ul className="mt-3 divide-y divide-border text-sm">
                {cityShares.map((c) => (
                  <li key={c.slug} className="flex items-baseline justify-between gap-3 py-2">
                    <Link href={powerOfSalePath(c.slug)} className="underline hover:text-foreground">
                      Power of sale homes in {c.city}
                    </Link>
                    <span className="tabular-nums text-muted-foreground">
                      {c.share != null && c.posSales != null ? `${c.posSales} sales, ${c.share.toFixed(2)}% of all sales` : "—"}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="mt-10">
            <HubFaq faqs={facts.faqs} heading={`Power of sale in ${place}: common questions`} />
          </div>

          {slug && <CityTopicLinks citySlug={slug} current="power-of-sale" />}

          {city && (
            <section className="mt-8">
              <h2 className="text-sm font-semibold text-muted-foreground">Other cities</h2>
              <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm">
                {others.map((c) => (
                  <Link key={c.slug} href={powerOfSalePath(c.slug)} className="underline hover:text-foreground">
                    {c.city}
                  </Link>
                ))}
              </p>
            </section>
          )}
        </div>

        <div className="mt-8">
          <ListingComplianceNotice />
        </div>
      </div>
    </main>
  );
}
