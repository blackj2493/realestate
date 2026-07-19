/**
 * Address-profile render for a key-less /address slug — an address that is neither for
 * sale nor in our sold window (ADDRESS_PROFILES_PLAN P1). Anonymous-safe BY CONSTRUCTION:
 *
 *  - Nearby ACTIVES lead (IDX — photos/prices/brokerage are public by design; brokerage
 *    shown on every card at the same type size as details, CLAUDE.md §4 + audit R2),
 *    with asking-side stats, a price-distribution histogram and the property-type mix —
 *    all computed from live IDX inventory, never sold/VOW data.
 *  - Schools (EQAO), daily-life amenities and geo "Things to Know" are open data.
 *  - The sold-history card is STATIC copy (no data fetch → no existence leak); the VOW
 *    consumer gate stays the conversion wall.
 *  - TrackAddressCard captures the email-only lead (rung 1); no account required.
 *
 * NO VOW field is fetched anywhere on this path.
 */
import Link from "next/link";
import {
  GraduationCap,
  Footprints,
  Lock,
  MapPin,
  Bell,
  TriangleAlert,
  Info,
  Dumbbell,
  Check,
} from "lucide-react";
import type { AddressProfile } from "@/lib/address/resolveProfile";
import { getNearbyForSale, type NearbyListing } from "@/lib/address/nearbyForSale";
import { getFlagsNearPoint, CHECKED_LABELS, type AddressFlag } from "@/lib/address/flagsNearPoint";
import { getNearbySchools, type NearbySchool } from "@/lib/schools/nearbySchoolList";
import { assignAmenities, NO_AMENITY_KM } from "@/lib/amenities/nearestAmenities";
import { cityHubSlug, slugify } from "@/lib/listings/listingPath";
import ListingComplianceNotice from "@/components/legal/ListingComplianceNotice";
import TrackAddressCard from "./TrackAddressCard";

function fmtPrice(n: number): string {
  return `$${Math.round(n).toLocaleString("en-CA")}`;
}

/** "$1.2M" / "$729k" — compact labels for the histogram axis. */
function fmtK(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  return `$${Math.round(n / 1000)}k`;
}

function fmtDist(m: number | null): string {
  if (m === null) return "";
  return m < 1000 ? `${Math.max(50, Math.round(m / 50) * 50)} m` : `${(m / 1000).toFixed(1)} km`;
}

function fmtKm(km: number): string {
  return km < 1 ? `${Math.max(50, Math.round((km * 1000) / 50) * 50)} m` : `${km.toFixed(1)} km`;
}

/* ── stat tiles ─────────────────────────────────────────────────────────── */

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card/40 p-4">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function LockedTile({ label }: { label: string }) {
  return (
    <Link
      href="/login"
      className="group rounded-lg border border-border bg-card/40 p-4 transition-colors hover:border-cyan-500/40"
    >
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="mt-1 flex items-center gap-2 text-lg font-bold text-muted-foreground group-hover:text-cyan-600 dark:group-hover:text-cyan-400">
        <Lock className="h-4 w-4" /> Members
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">Free account</p>
    </Link>
  );
}

/* ── listing card ───────────────────────────────────────────────────────── */

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

/* ── schools ────────────────────────────────────────────────────────────── */

function scoreClasses(score: number | null): string {
  if (score === null) return "border-border bg-muted/60 text-muted-foreground";
  if (score >= 8) return "border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400";
  if (score >= 6.5) return "border-cyan-500/30 bg-cyan-500/15 text-cyan-700 dark:text-cyan-400";
  return "border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-400";
}

function SchoolRow({ s }: { s: NearbySchool }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card/40 p-3">
      <span
        className={`grid h-10 w-10 shrink-0 place-items-center rounded-md border font-mono text-sm font-bold ${scoreClasses(s.score)}`}
        title={s.score !== null ? `EQAO score ${s.score.toFixed(1)}/10` : "Not yet rated"}
      >
        {s.score !== null ? s.score.toFixed(1) : "—"}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{s.name}</span>
        <span className="block text-xs capitalize text-muted-foreground">
          {s.system} · {s.level}
        </span>
      </span>
      <span className="shrink-0 font-mono text-xs text-emerald-700 dark:text-emerald-400">{fmtKm(s.distanceKm)}</span>
    </div>
  );
}

/* ── geo flags ──────────────────────────────────────────────────────────── */

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

/* ── page ───────────────────────────────────────────────────────────────── */

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
  const schools = lat !== null && lng !== null ? getNearbySchools(lat, lng).slice(0, 6) : [];
  let grocery: { name: string; km: number } | null = null;
  let rec: { name: string; km: number } | null = null;
  if (lat !== null && lng !== null) {
    try {
      const a = assignAmenities([lat, lng]);
      if (a.NearestGroceryKm < NO_AMENITY_KM) grocery = { name: a.NearestGroceryName, km: a.NearestGroceryKm };
      if (a.NearestRecCentreKm < NO_AMENITY_KM) rec = { name: a.NearestRecCentreName, km: a.NearestRecCentreKm };
    } catch {
      /* amenity data unavailable — cards simply don't render */
    }
  }

  const provLabel = provSlug.toUpperCase();
  const hubSlug = cityHubSlug(profile.city) || slugify(profile.city) || citySlug;
  const cityHref = `/property/${provSlug.toLowerCase()}/${hubSlug}`;
  const areaLabel = profile.cityRegion || profile.city;
  const stats = nearby?.stats;
  const medianAsking = stats?.medianAsking ?? null;

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

      <div className="mx-auto max-w-[980px] px-4 py-8">
        <nav className="mb-4 text-sm text-muted-foreground">
          <Link href="/properties" className="hover:text-cyan-600 dark:hover:text-cyan-400">Properties</Link>
          <span className="mx-2">/</span>
          <Link href={cityHref} className="hover:text-cyan-600 dark:hover:text-cyan-400">{profile.city}</Link>
          <span className="mx-2">/</span>
          <span className="text-foreground">{profile.address}</span>
        </nav>

        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">{profile.address}</h1>
          <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm text-muted-foreground">
            <MapPin className="h-4 w-4" />
            {[profile.cityRegion, profile.city, provLabel].filter(Boolean).join(", ")}
            {profile.postal && <span className="font-mono text-xs">{profile.postal}</span>}
            <span className="rounded-full border border-border bg-card/40 px-2.5 py-0.5 text-xs font-medium">
              Not currently for sale
            </span>
            {nearby && nearby.totalFound > 0 && (
              <a
                href="#for-sale"
                className="rounded-full border border-cyan-500/35 bg-cyan-500/10 px-2.5 py-0.5 text-xs font-medium text-cyan-700 hover:border-cyan-400 dark:text-cyan-400"
              >
                {nearby.totalFound} for sale nearby ↓
              </a>
            )}
          </p>
        </header>

        {/* ── Nearby actives: the hero. IDX = fully public, no gate. ── */}
        {nearby && nearby.listings.length > 0 && (
          <section id="for-sale" className="mb-8 scroll-mt-6">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              The market around {profile.address.split(",")[0]}
            </h2>
            <p className="mb-4 mt-1 text-sm text-muted-foreground">
              This home isn&apos;t on the market — {nearby.totalFound === 1 ? "one neighbour is" : `${nearby.totalFound} neighbours within ${nearby.radiusKm} km are`}. Live asking-side numbers below; sold-side numbers are free with an account.
            </p>

            {/* Stat tiles — IDX asking + momentum data, plus the gated breadcrumbs.
                "Price cuts" / listing-age come from the ACTIVE feed (permissible for
                anon per the compliance audit); days-to-SELL needs sold data → locked. */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              <StatTile label="For sale now" value={String(nearby.totalFound)} sub={`within ${nearby.radiusKm} km`} />
              {medianAsking !== null && <StatTile label="Median asking" value={fmtK(medianAsking)} sub="live listings" />}
              <StatTile
                label="Price cuts"
                value={`${nearby.momentum.cutCount} · ${Math.round(nearby.momentum.cutShare * 100)}%`}
                sub={nearby.momentum.medianCut !== null ? `median cut ${fmtK(nearby.momentum.medianCut)}` : "of live listings"}
              />
              <StatTile label="New this week" value={String(nearby.momentum.newThisWeek)} sub="listed in the last 7 days" />
              {stats?.medianDaysListed != null && (
                <StatTile label="Days listed" value={String(Math.round(stats.medianDaysListed))} sub="median, live listings" />
              )}
              <StatTile label="Sitting 30+ days" value={String(nearby.momentum.sitting30)} sub="of live listings" />
              {stats?.medianPsf != null && <StatTile label="Asking $/sqft" value={`$${Math.round(stats.medianPsf)}`} sub="where size is listed" />}
              <LockedTile label="Median sold price" />
              <LockedTile label="Days to sell" />
            </div>

            {/* Asking-price distribution + by-type breakdown — one glance at the market. */}
            {nearby.histogram && (
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-border bg-card/40 p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    Asking prices within {nearby.radiusKm} km
                  </p>
                  <div className="mt-3 flex h-24 items-end gap-[3px]" role="img" aria-label={`Distribution of ${nearby.totalFound} asking prices from ${fmtK(nearby.histogram.min)} to ${fmtK(nearby.histogram.max)}`}>
                    {(() => {
                      const peak = Math.max(...nearby.histogram!.buckets, 1);
                      return nearby.histogram!.buckets.map((c, i) => (
                        <div
                          key={i}
                          className={`flex-1 rounded-t-sm ${c > 0 ? "bg-emerald-500/75" : "bg-muted"}`}
                          style={{ height: c > 0 ? `${Math.max(8, (c / peak) * 100)}%` : "2px" }}
                          title={`${c} listing${c === 1 ? "" : "s"}`}
                        />
                      ));
                    })()}
                  </div>
                  <div className="mt-1.5 flex justify-between font-mono text-[10px] text-muted-foreground">
                    <span>{fmtK(nearby.histogram.min)}</span>
                    {medianAsking !== null && <span className="text-emerald-700 dark:text-emerald-400">median {fmtK(medianAsking)}</span>}
                    <span>{fmtK(nearby.histogram.max)}</span>
                  </div>
                </div>
                {nearby.typeMix.length > 0 && (
                  <div className="rounded-lg border border-border bg-card/40 p-4">
                    {(() => {
                      const total = nearby.typeMix.reduce((s, t) => s + t.count, 0) || 1;
                      const cols = "grid grid-cols-[minmax(0,1fr)_minmax(72px,110px)_2.25rem_4rem] items-center gap-x-3";
                      return (
                        <>
                          {/* Aligned header — reads as a table, not a stack of loading bars. */}
                          <div className={cols}>
                            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">By type</p>
                            <p className="text-right text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Share</p>
                            <p className="text-right text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">#</p>
                            <p className="text-right text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Median</p>
                          </div>
                          <div className="mt-2.5 space-y-2.5">
                            {nearby.typeMix.map((t) => {
                              const share = Math.round((t.count / total) * 100);
                              return (
                                <div key={t.label} className={cols}>
                                  <span className="truncate text-sm text-foreground" title={t.label}>{t.label}</span>
                                  <span className="flex items-center gap-1.5">
                                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                                      <span className="block h-full rounded-full bg-emerald-500/80" style={{ width: `${Math.max(share, 3)}%` }} />
                                    </span>
                                    <span className="w-7 shrink-0 text-right font-mono text-[10px] tabular-nums text-muted-foreground">{share}%</span>
                                  </span>
                                  <span className="text-right font-mono text-sm tabular-nums text-foreground">{t.count}</span>
                                  {/* A 1-2 sample "median" is noise (a lone $51M land parcel, say). */}
                                  <span className="text-right font-mono text-sm tabular-nums text-muted-foreground">
                                    {t.medianAsking !== null && t.count >= 3 ? fmtK(t.medianAsking) : "—"}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                          <p className="mt-3 text-[10px] text-muted-foreground">Share of the {total} nearest live listings · median = asking</p>
                        </>
                      );
                    })()}
                  </div>
                )}
              </div>
            )}

            {/* Horizontal carousel — CSS scroll-snap, no JS. */}
            <div className="-mx-1 mt-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-2">
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

        {/* ── Members gate: STATIC copy — no data fetched, nothing leaks. ── */}
        <section className="mb-8 rounded-lg border border-emerald-500/25 bg-emerald-500/[0.05] p-5">
          <h2 className="text-base font-bold text-foreground">
            What did homes in {areaLabel} actually sell for?
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Asking prices are only half the story. Real estate boards require a verified account for the other
            half — it takes a minute and it&apos;s free:
          </p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {[
              `Sold prices & history on this street`,
              `Median sold price & days-on-market for ${areaLabel}`,
              `Asking vs sold — who's overpricing, who's dealing`,
              `Deal Score & true days-on-market on every listing`,
            ].map((t) => (
              <li key={t} className="flex items-start gap-2 text-sm text-foreground">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                {t}
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Link
              href="/register"
              className="inline-flex h-10 items-center justify-center rounded-md bg-emerald-500 px-6 text-sm font-bold uppercase tracking-wider text-slate-950 transition-colors hover:bg-emerald-400"
            >
              Create free account
            </Link>
            <Link href="/login" className="text-sm text-cyan-700 hover:underline dark:text-cyan-400">
              Sign in
            </Link>
          </div>
        </section>

        {/* ── Things to Know: open-data geo flags. A clear result is still information —
            show it (soft wording: dataset COVERAGE varies by municipality, so "no hits"
            must never read as "we verified everything"). null = lookup failed → hide. ── */}
        {flags !== null && (
          <section className="mb-8">
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

        {/* ── Schools: every rated school within 2.5 km — names, EQAO scores, distance. ── */}
        {schools.length > 0 && (
          <section className="mb-8">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                <GraduationCap className="h-4 w-4 text-emerald-700 dark:text-emerald-400" /> Schools within 2.5 km
              </h2>
              <Link href={`/family/${hubSlug}/top-rated-schools`} className="text-xs text-cyan-700 hover:underline dark:text-cyan-400">
                All top-rated schools in {profile.city} →
              </Link>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {schools.map((s) => (
                <SchoolRow key={s.id} s={s} />
              ))}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">EQAO-based score out of 10 · straight-line distance</p>
          </section>
        )}

        {/* ── Daily life: nearest grocery + recreation (Overture open data). ── */}
        {(grocery || rec) && (
          <section className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {grocery && (
              <div className="flex items-center gap-3 rounded-lg border border-border bg-card/40 p-4">
                <Footprints className="h-5 w-5 shrink-0 text-sky-700 dark:text-sky-400" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-foreground">Groceries · {grocery.name}</span>
                  <span className="block text-xs text-muted-foreground">nearest supermarket</span>
                </span>
                <span className="font-mono text-xs text-emerald-700 dark:text-emerald-400">{fmtKm(grocery.km)}</span>
              </div>
            )}
            {rec && (
              <div className="flex items-center gap-3 rounded-lg border border-border bg-card/40 p-4">
                <Dumbbell className="h-5 w-5 shrink-0 text-sky-700 dark:text-sky-400" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-foreground">Recreation · {rec.name}</span>
                  <span className="block text-xs text-muted-foreground">nearest community/rec centre</span>
                </span>
                <span className="font-mono text-xs text-emerald-700 dark:text-emerald-400">{fmtKm(rec.km)}</span>
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
