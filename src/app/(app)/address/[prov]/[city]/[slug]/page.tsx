/**
 * Public address page — /address/{prov}/{city}/{street-slug}-{KEY} (Phase 4).
 *
 * The Zolo/HouseSigma model for sold/off-market properties: the page exists publicly and
 * ranks for the street address, but VOW Listing Information (sold price/date, beds/baths,
 * photos, brokerage) is shown ONLY to a signed-in registered consumer. Anonymous visitors
 * and Googlebot see address + neighbourhood + PUBLIC school/walkability context, the
 * SOLD/LEASED/OFF-MARKET status KIND (a public signal — the same one /properties already
 * shows anon; no price/date; audit R24a), plus a REDACTED teaser (the consumer's "Sale
 * history" card with labels/structure only — every value a placeholder that never carries
 * data) and a locked photo frame (only when the record actually has media, so "see photos"
 * is never a false promise). No price and no photo URL is ever fetched or rendered on the
 * anon path — the teaser just makes the gate legible and pushes the free sign-up.
 *
 * GATE (structural, stricter than Zolo's blur):
 *   - getSoldPublicByKey() uses Typesense include_fields → only address/city/region/geo
 *     are returned for the public render. It also fetches primaryImageUrl purely to derive
 *     a `hasPhoto` existence bit, discarding the URL (see soldByKey.ts) — the bit, not the
 *     media, reaches the anon UI.
 *   - getConsumer() (server-side) decides; the VOW fetches (getSoldGatedByKey +
 *     getSoldMediaByKey, which sources the real gallery) run ONLY inside the isConsumer
 *     branch, so VOW fields/photos are never fetched — let alone rendered — for anonymous
 *     users. The anon teaser is pure <Redact> placeholders; no gated value hits the DOM.
 *
 * Compliance: address is public-record; every value + photo stays behind the VOW login.
 * Deterministic (no LLM, §4). force-dynamic (the render depends on auth).
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { GraduationCap, Footprints, Lock, MapPin, Images } from "lucide-react";
import { extractListingKey, deslugCity, cityHubSlug } from "@/lib/listings/listingPath";
import { getSoldPublicByKey, getSoldGatedByKey, getSoldMediaByKey, type SoldPublic } from "@/lib/sold/soldByKey";
import { resolveAddressSlug } from "@/lib/address/resolveProfile";
import AddressProfileView from "@/components/address/AddressProfileView";
import AreaInsights from "@/components/address/AreaInsights";
import PropertyGallery from "@/app/(app)/properties/[id]/PropertyGallery";
import { Redact, UnlockCta } from "@/components/Property/teaserPrimitives";
import { Suspense } from "react";
import { getConsumer } from "@/lib/auth/requireConsumer";
import { assignSchools } from "@/lib/schools/nearestSchools";
import { assignAmenities, NO_AMENITY_KM } from "@/lib/amenities/nearestAmenities";
import ListingComplianceNotice from "@/components/legal/ListingComplianceNotice";

export const dynamic = "force-dynamic"; // render depends on auth (anon vs consumer)

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");

/** Public neighbourhood context (EQAO schools + Overture walkability) — best-effort. */
function publicContext(loc: [number, number] | null) {
  if (!loc) return null;
  try {
    const s = assignSchools(loc);
    const a = assignAmenities(loc);
    const grocery = a.NearestGroceryKm < NO_AMENITY_KM ? a.NearestGroceryKm : null;
    return {
      bestElem: s.BestElementaryScore > 0 ? s.BestElementaryScore : null,
      bestSec: s.BestSecondaryScore > 0 ? s.BestSecondaryScore : null,
      elemName: s.ElemPublicSchool || s.ElemCatholicSchool || "",
      groceryKm: grocery,
      groceryName: a.NearestGroceryName || "",
    };
  } catch {
    return null; // data files unavailable at runtime → degrade to address-only
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ prov: string; city: string; slug: string }>;
}): Promise<Metadata> {
  const { prov, city, slug } = await params;
  const key = extractListingKey(slug);
  const pub = key ? await getSoldPublicByKey(key) : null;
  if (!pub) {
    // Key-less slug → the profile ladder (ADDRESS_PROFILES_PLAN P1). Profiles are
    // noindex for v1 (unbounded URL space); redirect kinds get placeholder metadata.
    const resolved = key ? null : await resolveAddressSlug(city, slug);
    if (resolved?.kind === "profile") {
      const p = resolved.profile;
      const canonical = `${SITE_URL}/address/${prov.toLowerCase()}/${city}/${slug}`;
      return {
        metadataBase: new URL(SITE_URL),
        title: `${p.address} | PureProperty`,
        description: `${p.address}${p.city ? `, ${p.city}` : ""} — homes for sale nearby, neighbourhood schools and walkability. Track this address free on PureProperty.`,
        alternates: { canonical },
        robots: { index: false, follow: true },
      };
    }
    return { title: "Property not found | PureProperty", robots: { index: false, follow: false } };
  }

  const canonical = `${SITE_URL}/address/${prov.toLowerCase()}/${city}/${slug}`;
  const cityName = pub.city || deslugCity(city);
  const title = `${pub.address} | PureProperty`;
  const description = `${pub.address}${cityName ? `, ${cityName}` : ""} — property details, neighbourhood schools and walkability. Sign in to PureProperty to see this home's sale history.`;
  return {
    metadataBase: new URL(SITE_URL),
    title,
    description,
    alternates: { canonical },
    openGraph: { title: pub.address, description, url: canonical, siteName: "PureProperty", type: "website" },
  };
}

function GatedSection({ soldKey }: { soldKey: string }) {
  return <GatedSectionAsync soldKey={soldKey} />;
}

/** Rendered ONLY for a signed-in consumer — fetches + shows VOW Listing Information. */
async function GatedSectionAsync({ soldKey }: { soldKey: string }) {
  const d = await getSoldGatedByKey(soldKey);
  if (!d) return null;
  const fmt = (n?: number) => (typeof n === "number" && n > 0 ? `$${Math.round(n).toLocaleString()}` : "—");
  const soldDate =
    typeof d.PurchaseContractDate === "number" && d.PurchaseContractDate > 0
      ? // Epoch encodes a date-only value at UTC midnight — timeZone:'UTC' keeps the
        // rendered day server-TZ-independent (audit MEDIUM-18).
        new Date(d.PurchaseContractDate).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" })
      : null;
  const isSold = !d.DealType || d.DealType === "sold" || d.DealType === "leased";
  const rows: [string, string][] = [
    [d.DealType === "leased" ? "Leased price" : isSold ? "Sold price" : "Last list price", fmt(isSold ? d.ClosePrice : d.OriginalListPrice ?? d.ListPrice)],
    [d.DealType === "leased" ? "Leased on" : isSold ? "Sold on" : "Removed on", soldDate ?? "—"],
    ["Beds", d.BedroomsTotal ? String(d.BedroomsTotal) : "—"],
    ["Baths", d.BathroomsTotalInteger ? String(d.BathroomsTotalInteger) : "—"],
    ["Size", d.BuildingAreaTotal ? `${Math.round(d.BuildingAreaTotal).toLocaleString()} sqft` : "—"],
    ["Type", d.PropertySubType || "—"],
  ];
  // Real gallery for the signed-in consumer — the full listings.media_urls array when the
  // listing still has a row there, else the sold-store thumbnail. VOW media, fetched ONLY
  // here (inside the consumer-gated branch) — never on the anonymous path.
  const media = await getSoldMediaByKey(soldKey, d.primaryImageUrl);
  return (
    <div className="mb-6 space-y-4">
      {media.length > 0 && <PropertyGallery images={media} />}
      <section className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">Sale history</h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-muted-foreground">{k}</dt>
              <dd className="text-sm font-medium text-foreground">{v}</dd>
            </div>
          ))}
        </dl>
        {/* TRREB §6.3(c): brokerage shown with the listing details. */}
        <p className="mt-3 text-sm text-muted-foreground">Listed by {d.ListOfficeName || "Unknown"}</p>
      </section>
    </div>
  );
}

/**
 * Public transaction-status badge — the status KIND only (no price/date). Shown to anon AND
 * consumers so /address treats this signal the same way /properties already does for anon
 * (audit R24a). Rose = closed transaction (sold/leased); amber = off-market (de-list reason
 * stays gated, exactly as /properties nulls mlsStatus).
 */
function StatusBadge({ kind }: { kind: SoldPublic["dealKind"] }) {
  const label = kind === "sold" ? "SOLD" : kind === "leased" ? "LEASED" : "OFF MARKET";
  const cls =
    kind === "offmarket"
      ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
      : "bg-rose-500/15 text-rose-700 dark:text-rose-400";
  return (
    <span className={`rounded px-2 py-0.5 font-mono text-sm font-bold tracking-wider ${cls}`}>{label}</span>
  );
}

/** Status-aware copy for the price the gate withholds — mirrors the consumer row labels. */
function priceWordFor(kind: SoldPublic["dealKind"]): string {
  return kind === "leased" ? "lease price" : kind === "offmarket" ? "last price" : "sale price";
}

/**
 * Anonymous locked teaser — the SAME "Sale history" card a consumer sees, but redacted:
 * labels + structure only, every value a placeholder that never carries VOW data. A locked
 * photo frame appears ONLY when the record actually has media (hasPhoto), so "see photos"
 * is never a false promise. The status KIND (via the header badge) is public; the price is
 * not. This reveals no value or photo URL — it just makes the gate legible and pushes sign-up.
 */
const REDACTED_ROWS = ["Price", "Date", "Beds", "Baths", "Size", "Type"];

function AnonLocked({ hasPhoto, dealKind }: { hasPhoto: boolean; dealKind: SoldPublic["dealKind"] }) {
  const statusLine =
    dealKind === "sold" ? "This home has sold." : dealKind === "leased" ? "This home has been leased." : "This home is off-market.";
  const priceWord = priceWordFor(dealKind);
  return (
    <div className="mb-6 space-y-4">
      {hasPhoto && (
        <div className="relative h-[220px] overflow-hidden rounded-lg border border-border sm:h-[300px]">
          {/* Blurred frame stands in for the hero — a placeholder, no image URL is present. */}
          <div className="redact-skeleton absolute inset-0" aria-hidden="true" />
          <div className="absolute inset-0 flex items-center justify-center bg-background/40 backdrop-blur-[2px]">
            <span className="flex items-center gap-2 rounded-full border border-border bg-card/85 px-3 py-1.5 text-sm font-medium text-foreground">
              <Images className="h-4 w-4 text-cyan-700 dark:text-cyan-400" /> Photos locked
            </span>
          </div>
        </div>
      )}

      <section className="rounded-lg border border-border bg-card/40 p-5">
        <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-foreground">
          <Lock className="h-4 w-4 text-cyan-700 dark:text-cyan-400" /> Sale history
        </h2>
        <p className="mb-4 text-sm text-muted-foreground">
          {statusLine} Real estate boards require a free verified account to view its {priceWord}, history
          {hasPhoto ? " and photos" : ""}.
        </p>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
          {REDACTED_ROWS.map((label) => (
            <div key={label}>
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd>
                <Redact className="mt-0.5 h-4 w-16" />
              </dd>
            </div>
          ))}
        </dl>
        <UnlockCta
          label={hasPhoto ? `Sign up free to see the ${priceWord} & photos` : `Sign up free to see the ${priceWord}`}
          note="Sold data via TRREB VOW — for personal, non-commercial use."
        />
      </section>
    </div>
  );
}

export default async function AddressPage({
  params,
}: {
  params: Promise<{ prov: string; city: string; slug: string }>;
}) {
  const { prov, city, slug } = await params;
  const key = extractListingKey(slug);
  const pub: SoldPublic | null = key ? await getSoldPublicByKey(key) : null;
  if (!pub) {
    // Key-less slug: resolve instead of 404 (ADDRESS_PROFILES_PLAN P1).
    //  active → the listing page beats any profile; sold → canonical keyed gated page;
    //  geocoded/postal profile → render; nothing → notFound.
    const resolved = key ? null : await resolveAddressSlug(city, slug);
    if (resolved?.kind === "active") redirect(`/properties/${resolved.id}`);
    if (resolved?.kind === "sold") redirect(`/address/${prov.toLowerCase()}/${city}/${resolved.slug}`);
    if (resolved?.kind === "profile") {
      return (
        <AddressProfileView
          profile={resolved.profile}
          provSlug={prov}
          citySlug={city}
          canonical={`${SITE_URL}/address/${prov.toLowerCase()}/${city}/${slug}`}
        />
      );
    }
    notFound();
  }

  // Server-side auth decision. The VOW fetch is gated behind this.
  const { isConsumer } = await getConsumer();

  const cityName = pub.city || deslugCity(city);
  const provLabel = prov.toUpperCase();
  const cityHref = `/property/${prov.toLowerCase()}/${cityHubSlug(pub.city) || city}`;
  const canonical = `${SITE_URL}/address/${prov.toLowerCase()}/${city}/${slug}`;
  const ctx = publicContext(pub.location);

  // PUBLIC structured data — postal address only, NO sale information.
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Residence",
        name: pub.address,
        address: { "@type": "PostalAddress", streetAddress: pub.address, addressLocality: cityName, addressRegion: provLabel, addressCountry: "CA" },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
          { "@type": "ListItem", position: 2, name: "Properties", item: `${SITE_URL}/properties` },
          { "@type": "ListItem", position: 3, name: `${cityName}, ${provLabel}`, item: `${SITE_URL}${cityHref}` },
          { "@type": "ListItem", position: 4, name: pub.address, item: canonical },
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
          <Link href={cityHref} className="hover:text-cyan-600 dark:hover:text-cyan-400">{cityName}</Link>
          <span className="mx-2">/</span>
          <span className="text-foreground">{pub.address}</span>
        </nav>

        <header className="mb-6">
          <h1 className="text-2xl font-bold text-foreground sm:text-3xl">{pub.address}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <StatusBadge kind={pub.dealKind} />
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <MapPin className="h-4 w-4" />
              {[pub.cityRegion, cityName, provLabel].filter(Boolean).join(", ")}
            </p>
          </div>
        </header>

        {isConsumer ? (
          /* Signed-in consumer → VOW Listing Information + real gallery. */
          <GatedSection soldKey={pub.id} />
        ) : (
          /* Anonymous → locked teaser (structure only, no VOW values) + free sign-up push.
             No price and no photo URL is fetched or rendered on this path. */
          <AnonLocked hasPhoto={pub.hasPhoto} dealKind={pub.dealKind} />
        )}

        {/* Area insights — local market snapshot + nearby homes for sale/rent, so a visitor
            who hit an off-market home has somewhere to continue. Streamed (its Typesense +
            region-metrics fetches never block the address/sale-history above). Needs geo. */}
        {pub.location && (
          <Suspense fallback={null}>
            <AreaInsights
              lat={pub.location[0]}
              lng={pub.location[1]}
              city={pub.city}
              cityName={cityName}
              cityRegion={pub.cityRegion || null}
              cityHref={cityHref}
              isConsumer={isConsumer}
            />
          </Suspense>
        )}

        {/* PUBLIC neighbourhood context — EQAO schools + Overture walkability. Never VOW. */}
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

        {/* Public exploration links (internal-link value + crawl path). */}
        <section className="mb-8 flex flex-wrap gap-2">
          <Link href={cityHref} className="rounded-full border border-border bg-card/40 px-3 py-1.5 text-sm text-foreground hover:border-cyan-500/40 hover:text-cyan-300">
            Homes for sale in {cityName} →
          </Link>
          <Link href={`/family/${cityHubSlug(pub.city) || city}/top-rated-schools`} className="rounded-full border border-border bg-card/40 px-3 py-1.5 text-sm text-foreground hover:border-cyan-500/40 hover:text-cyan-300">
            Top-rated schools in {cityName} →
          </Link>
          <Link href={`/lifestyle/${cityHubSlug(pub.city) || city}/most-walkable`} className="rounded-full border border-border bg-card/40 px-3 py-1.5 text-sm text-foreground hover:border-cyan-500/40 hover:text-cyan-300">
            Most walkable homes in {cityName} →
          </Link>
        </section>

        <ListingComplianceNotice />
      </div>
    </main>
  );
}
