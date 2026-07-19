/**
 * Address-profile render for a key-less /address slug — an address that is neither for
 * sale nor in our sold window (ADDRESS_PROFILES_PLAN P1). Anonymous-safe BY CONSTRUCTION:
 *
 *  - Nearby ACTIVES lead (IDX — photos/prices/brokerage are public by design; brokerage
 *    shown on every card at the same type size as details, CLAUDE.md §4 + audit R2).
 *  - Schools/walkability + geo "Things to Know" are open data.
 *  - The sold-history card is STATIC copy (no data fetch → no existence leak); the VOW
 *    consumer gate stays the conversion wall.
 *  - TrackAddressCard captures the email-only lead (rung 1); no account required.
 *
 * NO VOW field is fetched anywhere on this path.
 */
import Link from "next/link";
import { GraduationCap, Footprints, Lock, MapPin, Bell, TriangleAlert, Info } from "lucide-react";
import type { AddressProfile } from "@/lib/address/resolveProfile";
import { getNearbyForSale, type NearbyListing } from "@/lib/address/nearbyForSale";
import { getFlagsNearPoint, CHECKED_LABELS, type AddressFlag } from "@/lib/address/flagsNearPoint";
import { assignSchools } from "@/lib/schools/nearestSchools";
import { assignAmenities, NO_AMENITY_KM } from "@/lib/amenities/nearestAmenities";
import { cityHubSlug, slugify } from "@/lib/listings/listingPath";
import ListingComplianceNotice from "@/components/legal/ListingComplianceNotice";
import TrackAddressCard from "./TrackAddressCard";

function fmtPrice(n: number): string {
  return `$${Math.round(n).toLocaleString("en-CA")}`;
}

function fmtDist(m: number | null): string {
  if (m === null) return "";
  return m < 1000 ? `${Math.max(50, Math.round(m / 50) * 50)} m` : `${(m / 1000).toFixed(1)} km`;
}

/** Same best-effort public context as the keyed sold /address page. */
function publicContext(loc: [number, number] | null) {
  if (!loc) return null;
  try {
    const s = assignSchools(loc);
    const a = assignAmenities(loc);
    const grocery = a.NearestGroceryKm < NO_AMENITY_KM ? a.NearestGroceryKm : null;
    return {
      bestElem: s.BestElementaryScore > 0 ? s.BestElementaryScore : null,
      bestSec: s.BestSecondaryScore > 0 ? s.BestSecondaryScore : null,
      groceryKm: grocery,
      groceryName: a.NearestGroceryName || "",
    };
  } catch {
    return null;
  }
}

function NearbyCard({ l }: { l: NearbyListing }) {
  return (
    <Link
      href={`/properties/${l.id}`}
      className="group w-60 shrink-0 snap-start overflow-hidden rounded-lg border border-border bg-card/40 transition-colors hover:border-cyan-500/40"
    >
      <div className="relative h-28 bg-muted">
        {l.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- MLS photos are never optimized (cost + TRREB watermark)
          <img src={l.imageUrl} alt={l.address} loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">No photo</div>
        )}
      </div>
      <div className="p-3">
        <p className="text-base font-bold text-foreground">{fmtPrice(l.price)}</p>
        {/* Details + brokerage share one type tier — §6.3: no visual de-emphasis. */}
        <p className="mt-0.5 text-xs text-muted-foreground">
          {[l.beds ? `${l.beds} bd` : null, l.baths ? `${l.baths} ba` : null, l.subType].filter(Boolean).join(" · ")}
        </p>
        <p className="mt-1 flex justify-between gap-2 text-xs text-muted-foreground">
          <span className="truncate">{l.address}</span>
          {l.distanceM !== null && <span className="shrink-0 text-emerald-700 dark:text-emerald-400">{fmtDist(l.distanceM)}</span>}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{l.brokerage ?? "Brokerage unavailable"}</p>
      </div>
    </Link>
  );
}

function FlagCard({ f }: { f: AddressFlag }) {
  const Icon = f.kind === "warn" ? TriangleAlert : Info;
  return (
    <div className="rounded-lg border border-border bg-card/40 p-4">
      <p className="flex items-start gap-2 text-sm font-medium text-foreground">
        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${f.kind === "warn" ? "text-amber-600 dark:text-amber-400" : "text-sky-700 dark:text-sky-400"}`} />
        {f.title}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{f.source}</p>
    </div>
  );
}

export default async function AddressProfileView({
  profile,
  provSlug,
  citySlug,
  canonical,
}: {
  profile: AddressProfile;
  provSlug: string;
  citySlug: string;
  canonical: string;
}) {
  const [lat, lng] = profile.location ?? [null, null];
  const [nearby, flags] = await Promise.all([
    lat !== null && lng !== null ? getNearbyForSale(lat, lng) : Promise.resolve(null),
    lat !== null && lng !== null ? getFlagsNearPoint(lat, lng) : Promise.resolve(null),
  ]);
  const ctx = publicContext(profile.location);

  const provLabel = provSlug.toUpperCase();
  const hubSlug = cityHubSlug(profile.city) || slugify(profile.city) || citySlug;
  const cityHref = `/property/${provSlug.toLowerCase()}/${hubSlug}`;

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Residence",
        name: profile.address,
        address: {
          "@type": "PostalAddress",
          streetAddress: profile.address,
          addressLocality: profile.city,
          addressRegion: provLabel,
          ...(profile.postal ? { postalCode: profile.postal } : {}),
          addressCountry: "CA",
        },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: "/" },
          { "@type": "ListItem", position: 2, name: "Properties", item: "/properties" },
          { "@type": "ListItem", position: 3, name: `${profile.city}, ${provLabel}`, item: cityHref },
          { "@type": "ListItem", position: 4, name: profile.address, item: canonical },
        ],
      },
    ],
  };

  return (
    <main className="min-h-app bg-background text-foreground">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <div className="mx-auto max-w-[900px] px-4 py-8">
        <nav className="mb-4 text-sm text-muted-foreground">
          <Link href="/properties" className="hover:text-cyan-600 dark:hover:text-cyan-400">Properties</Link>
          <span className="mx-2">/</span>
          <Link href={cityHref} className="hover:text-cyan-600 dark:hover:text-cyan-400">{profile.city}</Link>
          <span className="mx-2">/</span>
          <span className="text-foreground">{profile.address}</span>
        </nav>

        <header className="mb-6">
          <h1 className="text-2xl font-bold text-foreground sm:text-3xl">{profile.address}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted-foreground">
            <MapPin className="h-4 w-4" />
            {[profile.cityRegion, profile.city, provLabel, profile.postal].filter(Boolean).join(", ")}
            <span className="ml-2 rounded-full border border-border bg-card/40 px-2.5 py-0.5 text-xs font-medium">
              Not currently for sale
            </span>
          </p>
        </header>

        {/* ── Nearby actives: the hero. IDX = fully public, no gate. ── */}
        {nearby && nearby.listings.length > 0 && (
          <section className="mb-6">
            <h2 className="mb-1 text-sm font-semibold uppercase tracking-wider text-muted-foreground">For sale right now</h2>
            <p className="mb-3 text-sm text-muted-foreground">
              This home isn&apos;t on the market — {nearby.totalFound === 1 ? "this neighbour is" : `these neighbours are (${nearby.totalFound} within ${nearby.radiusKm} km)`}.
            </p>

            {/* Asking-price context — computed from live IDX actives only (no sold/VOW
                data); the locked chips are the breadcrumb to the consumer-gated layer. */}
            <div className="mb-4 flex flex-wrap gap-2 text-sm">
              {nearby.stats.medianAsking !== null && (
                <span className="rounded-md border border-border bg-card/40 px-3 py-1.5">
                  Median asking <strong className="font-bold">{fmtPrice(nearby.stats.medianAsking)}</strong>
                </span>
              )}
              {nearby.stats.medianPsf !== null && (
                <span className="rounded-md border border-border bg-card/40 px-3 py-1.5">
                  Asking <strong className="font-bold">${Math.round(nearby.stats.medianPsf)}</strong>/sqft
                </span>
              )}
              {nearby.stats.medianDaysListed !== null && (
                <span className="rounded-md border border-border bg-card/40 px-3 py-1.5">
                  Median <strong className="font-bold">{Math.round(nearby.stats.medianDaysListed)}</strong> days listed
                </span>
              )}
              <Link href="/login" className="flex items-center gap-1.5 rounded-md border border-border bg-card/40 px-3 py-1.5 text-muted-foreground transition-colors hover:border-cyan-500/40 hover:text-cyan-400">
                <Lock className="h-3.5 w-3.5" /> Median sold price
              </Link>
              <Link href="/login" className="flex items-center gap-1.5 rounded-md border border-border bg-card/40 px-3 py-1.5 text-muted-foreground transition-colors hover:border-cyan-500/40 hover:text-cyan-400">
                <Lock className="h-3.5 w-3.5" /> Sold days-on-market
              </Link>
            </div>

            {/* Horizontal carousel — CSS scroll-snap, no JS. */}
            <div className="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-2">
              {nearby.listings.map((l) => (
                <NearbyCard key={l.id} l={l} />
              ))}
            </div>
            <Link
              href={`/properties?city=${encodeURIComponent(profile.city)}`}
              className="mt-3 inline-flex h-10 items-center justify-center rounded-md bg-cyan-600 px-5 text-sm font-bold text-white transition-colors hover:bg-cyan-500"
            >
              See all {nearby.totalFound} for sale near here →
            </Link>
          </section>
        )}

        {/* ── Track this address: rung-1 lead capture, no account. ── */}
        <TrackAddressCard
          address={profile.address}
          city={profile.city}
          postal={profile.postal}
          lat={lat}
          lng={lng}
        />

        {/* ── Sold history: STATIC gated card — no data fetched, nothing leaks. ── */}
        <section className="mb-6 rounded-lg border border-border bg-card/40 p-5">
          <p className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Lock className="h-4 w-4 text-cyan-700 dark:text-cyan-400" /> Sale &amp; listing history
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Real estate boards require a verified account to view sold prices and listing history. Sign in or create a
            free PureProperty account to see what homes in {profile.cityRegion || profile.city} actually sold for.
          </p>
          <Link
            href="/login"
            className="mt-3 inline-flex h-10 items-center justify-center rounded-md bg-emerald-500 px-6 text-sm font-bold uppercase tracking-wider text-slate-950 transition-colors hover:bg-emerald-400"
          >
            Sign in to see sold history
          </Link>
        </section>

        {/* ── Things to Know: open-data geo flags. A clear result is still information —
            show it (soft wording: dataset COVERAGE varies by municipality, so "no hits"
            must never read as "we verified everything"). null = lookup failed → hide. ── */}
        {flags !== null && (
          <section className="mb-6">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Things to know nearby</h2>
            {flags.length > 0 ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {flags.map((f) => (
                  <FlagCard key={f.id} f={f} />
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-border bg-card/40 p-4">
                <p className="flex items-start gap-2 text-sm font-medium text-foreground">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-400" />
                  Nothing flagged around this address.
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  No hits in the public-record datasets we track ({CHECKED_LABELS.join(", ")}).
                  Coverage varies by municipality.
                </p>
              </div>
            )}
          </section>
        )}

        {/* ── Public neighbourhood context — EQAO schools + Overture walkability. ── */}
        {ctx && (ctx.bestElem || ctx.bestSec || ctx.groceryKm !== null) && (
          <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {(ctx.bestElem || ctx.bestSec) && (
              <div className="rounded-lg border border-border bg-card/40 p-4">
                <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
                  <GraduationCap className="h-4 w-4 text-emerald-700 dark:text-emerald-400" /> Nearby schools
                </h3>
                <p className="text-sm text-muted-foreground">
                  {ctx.bestElem ? `Best elementary ${ctx.bestElem.toFixed(1)}/10` : ""}
                  {ctx.bestElem && ctx.bestSec ? " · " : ""}
                  {ctx.bestSec ? `Best secondary ${ctx.bestSec.toFixed(1)}/10` : ""}
                </p>
              </div>
            )}
            {ctx.groceryKm !== null && (
              <div className="rounded-lg border border-border bg-card/40 p-4">
                <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Footprints className="h-4 w-4 text-sky-700 dark:text-sky-400" /> Walkability
                </h3>
                <p className="text-sm text-muted-foreground">
                  Nearest grocery {ctx.groceryKm < 1 ? `${Math.max(50, Math.round((ctx.groceryKm * 1000) / 50) * 50)} m` : `${ctx.groceryKm.toFixed(1)} km`} away
                  {ctx.groceryName ? ` (${ctx.groceryName})` : ""}.
                </p>
              </div>
            )}
          </section>
        )}

        {profile.provenance === "postal" && (
          <p className="mb-6 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Bell className="h-3.5 w-3.5" /> Location is approximate — placed from postal code {profile.postal}.
          </p>
        )}

        {/* Public exploration links (internal-link value + crawl path). */}
        <section className="mb-8 flex flex-wrap gap-2">
          <Link href={cityHref} className="rounded-full border border-border bg-card/40 px-3 py-1.5 text-sm text-foreground hover:border-cyan-500/40 hover:text-cyan-300">
            Homes for sale in {profile.city} →
          </Link>
          <Link href={`/family/${hubSlug}/top-rated-schools`} className="rounded-full border border-border bg-card/40 px-3 py-1.5 text-sm text-foreground hover:border-cyan-500/40 hover:text-cyan-300">
            Top-rated schools in {profile.city} →
          </Link>
          <Link href={`/lifestyle/${hubSlug}/most-walkable`} className="rounded-full border border-border bg-card/40 px-3 py-1.5 text-sm text-foreground hover:border-cyan-500/40 hover:text-cyan-300">
            Most walkable homes in {profile.city} →
          </Link>
        </section>

        <ListingComplianceNotice />
      </div>
    </main>
  );
}
