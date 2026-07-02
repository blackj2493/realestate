/**
 * Public address page — /address/{prov}/{city}/{street-slug}-{KEY} (Phase 4).
 *
 * The Zolo/HouseSigma model for sold/off-market properties: the page exists publicly and
 * ranks for the street address, but VOW Listing Information (sold price/date, beds/baths,
 * photos, brokerage) is shown ONLY to a signed-in registered consumer. Anonymous visitors
 * and Googlebot see address + neighbourhood + PUBLIC school/walkability context + a sign-in
 * CTA — and nothing else.
 *
 * GATE (structural, stricter than Zolo's blur):
 *   - getSoldPublicByKey() uses Typesense include_fields → only address/city/region/geo
 *     ever leave the collection for the public render.
 *   - getConsumer() (server-side) decides; the VOW fetch (getSoldGatedByKey) runs ONLY
 *     inside the isConsumer branch, so VOW fields are never fetched — let alone rendered —
 *     for anonymous users. There is no CSS-blurred data in the page source.
 *
 * Compliance: address is public-record; everything else stays behind the VOW login.
 * Deterministic (no LLM, §4). force-dynamic (the render depends on auth).
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { GraduationCap, Footprints, Lock, MapPin } from "lucide-react";
import { extractListingKey, deslugCity, cityHubSlug } from "@/lib/listings/listingPath";
import { getSoldPublicByKey, getSoldGatedByKey, type SoldPublic } from "@/lib/sold/soldByKey";
import { getConsumer } from "@/lib/auth/requireConsumer";
import { assignSchools } from "@/lib/schools/nearestSchools";
import { assignAmenities, NO_AMENITY_KM } from "@/lib/amenities/nearestAmenities";
import ListingComplianceNotice from "@/components/legal/ListingComplianceNotice";
import AddressSignInCta from "./AddressSignInCta";

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
  if (!pub) return { title: "Property not found | PureProperty", robots: { index: false, follow: false } };

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
      ? new Date(d.PurchaseContractDate).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" })
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
  return (
    <section className="mb-6 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] p-5">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-emerald-300">Sale history</h2>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt className="text-xs text-slate-500">{k}</dt>
            <dd className="text-sm font-medium text-slate-100">{v}</dd>
          </div>
        ))}
      </dl>
      {/* TRREB §6.3(c): brokerage shown with the listing details. */}
      <p className="mt-3 text-sm text-slate-400">Listed by {d.ListOfficeName || "Unknown"}</p>
    </section>
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
  if (!pub) notFound();

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
    <main className="min-h-app bg-slate-950 text-slate-200">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <div className="mx-auto max-w-[900px] px-4 py-8">
        <nav className="mb-4 text-sm text-slate-500">
          <Link href="/properties" className="hover:text-cyan-400">Properties</Link>
          <span className="mx-2">/</span>
          <Link href={cityHref} className="hover:text-cyan-400">{cityName}</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-300">{pub.address}</span>
        </nav>

        <header className="mb-6">
          <h1 className="text-2xl font-bold text-slate-100 sm:text-3xl">{pub.address}</h1>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-400">
            <MapPin className="h-4 w-4" />
            {[pub.cityRegion, cityName, provLabel].filter(Boolean).join(", ")}
          </p>
        </header>

        {isConsumer ? (
          /* Signed-in consumer → VOW Listing Information. */
          <GatedSection soldKey={pub.id} />
        ) : (
          /* Anonymous → sign-in CTA. No VOW data is fetched or rendered. */
          <section className="mb-6 rounded-lg border border-slate-800 bg-slate-900/40 p-5">
            <p className="flex items-center gap-2 text-sm font-medium text-slate-200">
              <Lock className="h-4 w-4 text-cyan-400" /> This home isn&apos;t currently listed for sale.
            </p>
            <p className="mt-1 text-sm text-slate-400">
              Real estate boards require a verified account to view sale history and listing details. Sign in or create a free PureProperty account to see this property&apos;s record.
            </p>
            <AddressSignInCta
              intent={{ label: cityName, slug: cityHubSlug(pub.city) || city, prov: prov.toLowerCase() }}
              next={`/address/${prov.toLowerCase()}/${city}/${slug}`}
            />
          </section>
        )}

        {/* PUBLIC neighbourhood context — EQAO schools + Overture walkability. Never VOW. */}
        {ctx && (ctx.bestElem || ctx.bestSec || ctx.groceryKm !== null) && (
          <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {(ctx.bestElem || ctx.bestSec) && (
              <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
                <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-200">
                  <GraduationCap className="h-4 w-4 text-emerald-400" /> Nearby schools
                </h3>
                <p className="text-sm text-slate-400">
                  {ctx.bestElem ? `Best elementary ${ctx.bestElem.toFixed(1)}/10` : ""}
                  {ctx.bestElem && ctx.bestSec ? " · " : ""}
                  {ctx.bestSec ? `Best secondary ${ctx.bestSec.toFixed(1)}/10` : ""}
                </p>
              </div>
            )}
            {ctx.groceryKm !== null && (
              <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
                <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-200">
                  <Footprints className="h-4 w-4 text-sky-400" /> Walkability
                </h3>
                <p className="text-sm text-slate-400">
                  Nearest grocery {ctx.groceryKm < 1 ? `${Math.max(50, Math.round((ctx.groceryKm * 1000) / 50) * 50)} m` : `${ctx.groceryKm.toFixed(1)} km`} away
                  {ctx.groceryName ? ` (${ctx.groceryName})` : ""}.
                </p>
              </div>
            )}
          </section>
        )}

        {/* Public exploration links (internal-link value + crawl path). */}
        <section className="mb-8 flex flex-wrap gap-2">
          <Link href={cityHref} className="rounded-full border border-slate-800 bg-slate-900/40 px-3 py-1.5 text-sm text-slate-300 hover:border-cyan-500/40 hover:text-cyan-300">
            Homes for sale in {cityName} →
          </Link>
          <Link href={`/family/${cityHubSlug(pub.city) || city}/top-rated-schools`} className="rounded-full border border-slate-800 bg-slate-900/40 px-3 py-1.5 text-sm text-slate-300 hover:border-cyan-500/40 hover:text-cyan-300">
            Top-rated schools in {cityName} →
          </Link>
          <Link href={`/lifestyle/${cityHubSlug(pub.city) || city}/most-walkable`} className="rounded-full border border-slate-800 bg-slate-900/40 px-3 py-1.5 text-sm text-slate-300 hover:border-cyan-500/40 hover:text-cyan-300">
            Most walkable homes in {cityName} →
          </Link>
        </section>

        <ListingComplianceNotice />
      </div>
    </main>
  );
}
