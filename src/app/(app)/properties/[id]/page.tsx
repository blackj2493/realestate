/**
 * /properties/[id] — server-rendered, SEO-optimized listing detail page.
 *
 * Ported from the Command Center's ListingTerminal 70/30 layout, but fed by the
 * full Supabase payload (real rooms, all photos, AVM estimate, condo-fee stability)
 * and emitting per-listing <title>/meta/OpenGraph + JSON-LD for crawlers.
 *
 * Compliance: serves the `listings` table; sold/de-listed states render status-aware
 * views with VOW numbers gated (kind public, prices/dates authed-only); brokerage is
 * displayed; all derived metrics are deterministic (no LLM transformation).
 */

import type { Metadata } from "next";
import Link from "next/link";
import { Bed, Bath, Square, Car, AlertTriangle, Building2, ChevronDown } from "lucide-react";
import { cn, formatPrice } from "@/lib/utils";
import { gateVowDerived } from "@/lib/property/getListingDetail";
import { getListingDetailCached } from "@/lib/property/getListingDetailCached";
import { buildListingPath, cityHubSlug, cityHubResolves } from "@/lib/listings/listingPath";
import { resolveSalePrice } from "@/lib/avm/salePrice";
import { bedsLabel } from "@/lib/listings/bedsLabel";
import { shouldRender as hasValueAddData } from "@/components/Property/forceAppreciationView";
import { getCurrentUser } from "@/lib/supabase/server";
import { AlphaBadge, detectPropertyBadges } from "@/components/CommandCenter/AlphaBadge";
import UnderwritingSandbox from "@/components/Property/UnderwritingSandbox";
import RentalSnapshot from "@/components/Property/RentalSnapshot";
import { buildListingOffer } from "@/lib/property/listingOffer";
import { isIncomeProperty } from "@/lib/underwriting/computeUnderwriting";
import RoomMap from "@/components/Property/RoomMap";
import PropertyDataSheet from "@/components/Property/PropertyDataSheet";
import { buildDatasheet } from "@/lib/property/datasheet";
import ThingsToKnowCard from "@/components/Property/ThingsToKnowCard";
import { buildDiligenceFlags } from "@/lib/property/diligence";
import YourTakeCard from "@/components/Property/YourTakeCard";
import DOMTimelineChart, { type SaleMarker } from "@/components/CommandCenter/DOMTimelineChart";
import ListingEstimateCard from "@/components/Property/ListingEstimateCard";
import EstimatedSaleCard from "@/components/Property/EstimatedSaleCard";
import ForceAppreciationCard from "@/components/Property/ForceAppreciationCard";
import Disclaimers from "@/components/hiddenEquity/Disclaimers";
import ListingComplianceNotice from "@/components/legal/ListingComplianceNotice";
import CondoFeeStabilityCard from "@/components/Property/CondoFeeStabilityCard";
import SaleHistorySection from "@/components/Property/SaleHistorySection";
import CampaignHistoryChart from "@/components/CommandCenter/CampaignHistoryChart";
import CampaignHistorySection from "@/components/Property/CampaignHistorySection";
import DealScoreCard, { DealScoreBadge } from "@/components/Property/DealScoreCard";
import SoldOutcomeCard from "@/components/Property/SoldOutcomeCard";
import SocialProofBar from "@/components/Property/SocialProofBar";
import SimilarProperties from "@/components/Property/SimilarProperties";
import TheReadCard from "@/components/Property/TheReadCard";
import { buildTheRead } from "@/lib/property/theRead";
import { resolvePersona } from "@/lib/personas/resolvePersona";
import WatchButton from "@/components/watchlist/WatchButton";
import MobileActionBar from "./MobileActionBar";
import PropertyGallery from "./PropertyGallery";
import RecordView from "./RecordView";
import ListingActions from "./ListingActions";
import NearbySchools from "./NearbySchools";
import NearbyAmenities from "./NearbyAmenities";
import PropertyNotFound from "./PropertyNotFound";
import DetailMobileNav from "./DetailMobileNav";
import ClampText from "./ClampText";

export const dynamic = "force-dynamic";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");

/**
 * Canonical descriptive URL for a listing (Phase 1c):
 *   {SITE}/property/{prov}/{city}/{address}-{KEY}
 * Used by the page metadata + JSON-LD regardless of which URL the visitor arrived on
 * (the middleware rewrites the descriptive path to this /properties/[id] route). Falls
 * back to the legacy /properties/<KEY> path if the payload can't form a slug.
 */
function listingCanonical(id: string, p: RawListing): string {
  const path =
    buildListingPath({
      ListingKey: id,
      StreetNumber: p.StreetNumber,
      StreetName: p.StreetName,
      StreetSuffix: p.StreetSuffix,
      StreetDirPrefix: p.StreetDirPrefix,
      StreetDirSuffix: p.StreetDirSuffix,
      UnitNumber: p.UnitNumber,
      ApartmentNumber: p.ApartmentNumber,
      UnparsedAddress: p.UnparsedAddress,
      City: p.City,
      StateOrProvince: p.StateOrProvince,
    }) ?? `/properties/${id}`;
  return `${SITE_URL}${path}`;
}

/**
 * Path to this listing's city hub (/property/{prov}/{city}), or null when the hub
 * wouldn't resolve (district-split cities like Toronto/London — see cityHubResolves;
 * they come online with 2b-ii's CitySlug). Drives the breadcrumb crawl-link + JSON-LD.
 */
function cityHubPath(p: { City?: string; StateOrProvince?: string }): string | null {
  if (!p.City || !cityHubResolves(p.City)) return null;
  return `/property/${(p.StateOrProvince || "ON").toLowerCase()}/${cityHubSlug(p.City)}`;
}

interface RawListing {
  ListingKey?: string;
  ListPrice?: number;
  OriginalListPrice?: number;
  UnparsedAddress?: string;
  StreetNumber?: string;
  StreetName?: string;
  StreetSuffix?: string;
  StreetDirPrefix?: string;
  StreetDirSuffix?: string;
  UnitNumber?: string;
  ApartmentNumber?: string;
  City?: string;
  CityRegion?: string;
  StateOrProvince?: string;
  PostalCode?: string;
  BedroomsTotal?: number;
  BedroomsAboveGrade?: number;
  BedroomsBelowGrade?: number;
  BathroomsTotalInteger?: number;
  KitchensTotal?: number;
  KitchensAboveGrade?: number;
  KitchensBelowGrade?: number;
  RoomsTotal?: number;
  RoomsAboveGrade?: number;
  RoomsBelowGrade?: number;
  ListOfficeName?: string;
  PropertyType?: string;
  PropertySubType?: string;
  ArchitecturalStyle?: string[] | string;
  ApproximateAge?: string;
  Basement?: string[] | string;
  DirectionFaces?: string;
  LotWidth?: number;
  LotDepth?: number;
  LotSizeUnits?: string;
  BuildingAreaTotal?: number;
  LivingAreaRange?: string;
  ParkingTotal?: number;
  CoveredSpaces?: number;
  HeatType?: string;
  HeatSource?: string;
  Cooling?: string[] | string;
  TaxAnnualAmount?: number;
  AssociationFee?: number;
  PublicRemarks?: string;
  StandardStatus?: string;
  DaysOnMarket?: number;
  OriginalEntryTimestamp?: string;
  TransactionType?: string;
  LeaseTerm?: string;
  DepositRequired?: boolean;
  RentIncludes?: string[];
}

function calculateDaysOnMarket(ts?: string): number {
  if (!ts) return 0;
  const diff = Date.now() - new Date(ts).getTime();
  return Math.max(0, Math.ceil(diff / 86_400_000) - 1);
}

/** Format a feed date; malformed strings pass through raw instead of "Invalid Date". */
function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });
}

function cleanDescription(remarks: string | undefined, max = 155): string {
  if (!remarks) return "";
  const flat = remarks.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

// ── SEO metadata (shares the cached getListingDetail call with the page body) ──
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const detail = await getListingDetailCached(id).catch(() => null);

  if (!detail) {
    return {
      title: "Property Syncing | PureProperty",
      robots: { index: false, follow: true },
    };
  }

  const p = detail.full_payload as RawListing;
  const address = p.UnparsedAddress || detail.city || "Listing";
  const price = p.ListPrice || 0;
  const canonical = listingCanonical(id, p);
  const statusSuffix =
    detail.status.kind === "sold"
      ? ` — ${detail.status.label}`
      : detail.status.kind === "delisted"
        ? " — Off Market"
        : "";
  const title = `${address} — ${formatPrice(price)}${statusSuffix} | PureProperty`;
  const description =
    cleanDescription(p.PublicRemarks) ||
    `${address}. ${p.BedroomsTotal ?? 0} bed, ${p.BathroomsTotalInteger ?? 0} bath ${
      p.PropertySubType || "home"
    } listed at ${formatPrice(price)}.`;
  // Frozen-Active payloads (Terminated/Expired/Suspended) must noindex too — trust
  // the resolved status, not the stale payload field.
  const isActive =
    detail.status.kind === "active" && (p.StandardStatus ?? "Active") === "Active";
  const ogImage = detail.media_urls[0];

  return {
    metadataBase: new URL(SITE_URL),
    title,
    description,
    alternates: { canonical },
    robots: isActive ? undefined : { index: false, follow: true },
    openGraph: {
      title,
      description,
      url: canonical,
      siteName: "PureProperty",
      type: "website",
      ...(ogImage ? { images: [{ url: ogImage }] } : {}),
    },
    twitter: {
      card: ogImage ? "summary_large_image" : "summary",
      title,
      description,
      ...(ogImage ? { images: [ogImage] } : {}),
    },
  };
}

function buildJsonLd(id: string, detail: Awaited<ReturnType<typeof getListingDetailCached>>) {
  if (!detail) return null;
  const p = detail.full_payload as RawListing;
  const subType = (p.PropertySubType || "").toLowerCase();
  // Accommodation (Place) subtype carries the structural facts (beds/baths/area).
  const accommodationType = /condo|apartment/.test(subType) ? "Apartment" : "SingleFamilyResidence";
  const url = listingCanonical(id, p);
  const cityPath = cityHubPath(p);
  const photos = detail.media_urls.slice(0, 8);
  const availability =
    detail.status.kind === "sold"
      ? "https://schema.org/SoldOut"
      : detail.status.kind === "delisted"
        ? "https://schema.org/OutOfStock"
        : "https://schema.org/InStock";

  // Listing brokerage (§6.3(c)) — surfaced in structured data as well as on-page.
  // RealEstateOrganization is the listing OFFICE (ListOfficeName), not an agent.
  const broker = p.ListOfficeName
    ? { "@type": "RealEstateOrganization" as const, name: p.ListOfficeName }
    : undefined;

  // For-Lease listings carry the monthly rent in ListPrice; modelled as a recurring
  // per-month price (not a bare sale `price`) so search engines don't read the rental
  // as a home for sale at the rent figure. See buildListingOffer.
  const isLease = /lease/i.test(p.TransactionType ?? "");
  const offer = buildListingOffer({
    listPrice: p.ListPrice || 0,
    isLease,
    availability,
    url,
    seller: broker,
  });

  // @graph: a RealEstateListing (the page) → its Accommodation (the property) →
  // a clean BreadcrumbList. Note: Google has no real-estate rich result, so the
  // listing/offer nodes are for entity understanding only; the BreadcrumbList is
  // the single node here that actually renders as a SERP rich result, so it is
  // kept strictly valid (3 distinct URLs, sequential positions).
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "RealEstateListing",
        "@id": `${url}#listing`,
        url,
        name: p.UnparsedAddress || "Property listing",
        description: cleanDescription(p.PublicRemarks, 500) || undefined,
        ...(p.OriginalEntryTimestamp ? { datePosted: p.OriginalEntryTimestamp } : {}),
        ...(photos.length ? { image: photos } : {}),
        mainEntity: { "@id": `${url}#property` },
        ...(broker ? { provider: broker } : {}),
      },
      {
        "@type": accommodationType,
        "@id": `${url}#property`,
        name: p.UnparsedAddress || "Property listing",
        numberOfRooms: p.RoomsTotal || detail.rooms.length || undefined,
        numberOfBedrooms: p.BedroomsTotal || undefined,
        numberOfBathroomsTotal: p.BathroomsTotalInteger || undefined,
        ...(p.BuildingAreaTotal
          ? { floorSize: { "@type": "QuantitativeValue", value: p.BuildingAreaTotal, unitCode: "FTK" } }
          : {}),
        address: {
          "@type": "PostalAddress",
          streetAddress: p.UnparsedAddress || undefined,
          addressLocality: p.City || detail.city || undefined,
          addressRegion: p.StateOrProvince || "ON",
          postalCode: p.PostalCode || undefined,
          addressCountry: "CA",
        },
        offers: offer,
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
          { "@type": "ListItem", position: 2, name: "Properties", item: `${SITE_URL}/properties` },
          ...(cityPath && p.City
            ? [{ "@type": "ListItem", position: 3, name: p.City, item: `${SITE_URL}${cityPath}` }]
            : []),
          {
            "@type": "ListItem",
            position: cityPath ? 4 : 3,
            name: p.UnparsedAddress || "Listing",
            item: url,
          },
        ],
      },
    ],
  };
}

export default async function PropertyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ lens?: string }>;
}) {
  const { id } = await params;
  // Persona lens carried from the terminal (?lens=) so the Deal Score + The Read
  // open on the lens the user was browsing in; falls back to the Homebuyer view.
  const { lens: lensParam } = await searchParams;
  const lens = resolvePersona("detail", { url: lensParam });
  const detail = await getListingDetailCached(id).catch(() => null);

  if (!detail) {
    return (
      <main className="min-h-app bg-slate-950">
        <PropertyNotFound id={id} />
      </main>
    );
  }

  // VOW gating: strip sold prices/dates AND VOW-derived metrics (AVM, Value-Add,
  // Deal Score, stitched True DOM) for anonymous users — the numbers never reach the
  // client; the cards render blurred "Login Required" teasers (§4; §6.2(f)). The
  // has* flags (computed from the ungated detail) drive the teaser only where real
  // data exists, so we never tease an empty card.
  const isAuthed = !!(await getCurrentUser());
  const hasEstimate = (detail.estimate?.estimatedValue ?? 0) > 0;
  const hasValueAdd = hasValueAddData(detail.valueAdd);
  const hasDealScore = detail.dealScore.score !== null;
  const hasExpectedSale = (detail.expectedSale?.expectedPrice ?? 0) > 0;
  const hasSoldAccuracy = detail.soldAccuracy !== null;
  const hasSoldPrice = detail.status.kind === "sold" && detail.status.closePrice !== null;
  const view = gateVowDerived(detail, isAuthed);
  // ALWAYS read status/accuracy from the gated view below — detail.status carries
  // ungated VOW sold numbers (anon must never receive them).
  const status = view.status;
  const soldAccuracy = view.soldAccuracy;
  const isActiveListing = status.kind === "active";
  const soldPrice = status.kind === "sold" ? status.closePrice : null;
  const soldDate = status.kind === "sold" ? status.soldDate : null;
  const saleHistory = view.saleHistory;
  // Prior sold prices for the price-history chart — authed only (events are empty otherwise).
  const saleMarkers: SaleMarker[] = saleHistory.events
    .filter((e) => e.close_price && e.close_price > 0 && (e.contract_date || e.close_date))
    .map((e) => ({ date: (e.contract_date || e.close_date) as string, price: e.close_price as number }));

  const p = detail.full_payload as RawListing;
  const address = p.UnparsedAddress || detail.city || "Address Unavailable";
  const cityHref = cityHubPath(p);
  const price = p.ListPrice || 0;
  // THE single price number — list-anchored Expected Sale where we can (most accurate),
  // AVM as the honest fallback. Replaces the old two-number display. (null for anon: the
  // VOW-gated view nulls both inputs → the card renders its locked teaser.)
  const salePrice = resolveSalePrice({
    listPrice: price > 0 ? price : null,
    isActive: status.kind === "active",
    expectedSale: view.expectedSale,
    estimate: view.estimate,
  });
  const dom = p.DaysOnMarket ?? calculateDaysOnMarket(p.OriginalEntryTimestamp);
  // True DOM (stitched across relists) from the Temporal Distress Engine; falls back to raw DOM.
  // Gated (null) for anon → falls back to raw IDX DaysOnMarket.
  const trueDom = view.priceTimeline.trueDom ?? dom;
  // eslint-disable-next-line react-hooks/purity -- server component (force-dynamic); a per-request "now" is intentional for the live True DOM span / active-campaign end
  const nowMs = Date.now();
  const rooms = detail.rooms;
  const hasSuitePotential = (p.KitchensBelowGrade ?? 0) > 0;
  // C2 (UX audit 2026-06-13): vacant land has no rental income, so the income
  // side of the underwrite (rent → cap rate, gross yield, cashflow) is a
  // fabrication on these parcels. Gate it so the sandbox shows carrying cost
  // only rather than inventing a rent.
  const incomeApplicable = isIncomeProperty(p.PropertySubType);
  // For-Lease listings carry the monthly rent in ListPrice, not a purchase price, so
  // the buy-and-hold Underwriting Sandbox can only fabricate (a $540 down payment, a
  // 516% cap rate). Detect the lease and show a Rental Snapshot instead. Same criterion
  // datasheet.ts uses to gate the Lease Terms group (§6.3(f)).
  const isLease = /lease/i.test(p.TransactionType ?? "");
  const jsonLd = buildJsonLd(id, detail);

  const badges = detectPropertyBadges({
    hasSecondarySuitePotential: hasSuitePotential,
    KitchensBelowGrade: p.KitchensBelowGrade,
    PublicRemarks: p.PublicRemarks,
    ListPrice: p.ListPrice,
    OriginalListPrice: p.OriginalListPrice,
    DaysOnMarket: dom,
  });

  // Gated payload (defense-in-depth): anon view has sold price/date keys scrubbed,
  // so a future registry field can never surface them here. Identical for authed users.
  const datasheet = buildDatasheet(view.full_payload);
  // Things to Know — payload-derived diligence flags (Phase 1) merged with
  // geo-joined public-records flags (Phase 2: flood/rail/traffic). Public data is
  // not VOW-gated, so view.geoFlags is populated for anon users too. Feeds The Read.
  const diligenceFlags = buildDiligenceFlags(view.full_payload, view.geoFlags);

  // Mobile section jumper — lets phones skip straight to a section instead of
  // scrolling the full ~10-screen page (financials stack last on mobile).
  const navSections = [
    { id: "overview", label: "Overview" },
    { id: "financials", label: "Financials" },
    { id: "details", label: "Details" },
    ...(rooms.length > 0 ? [{ id: "rooms", label: "Rooms" }] : []),
    { id: "history", label: "History" },
    { id: "comps", label: "Comps" },
  ];

  return (
    <main className="min-h-app bg-slate-950 text-slate-200">
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
      <RecordView
        id={id}
        address={address}
        price={price}
        thumb={detail.media_urls[0]}
        city={detail.city ?? undefined}
        brokerage={p.ListOfficeName}
      />

      <div className="mx-auto max-w-[1400px] px-4 pt-6 pb-28 lg:pb-6">
        {/* Breadcrumb — also the crawl link from a listing up to its city hub, when
            that hub resolves (closes the hub→listing→hub internal-link loop; §Phase 2). */}
        <nav className="mb-4 flex flex-wrap items-center gap-x-2 text-sm text-slate-500">
          <Link href="/properties" className="text-cyan-400 transition-colors hover:text-cyan-300">
            Command Center
          </Link>
          {cityHref && p.City && (
            <>
              <span aria-hidden>/</span>
              <Link href={cityHref} className="text-cyan-400 transition-colors hover:text-cyan-300">
                Homes for sale in {p.City}
              </Link>
            </>
          )}
        </nav>

        <DetailMobileNav sections={navSections} />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[7fr_3fr]">
          {/* ── LEFT (70%) ── */}
          <div>
            {/* Header */}
            <div id="overview" className="mb-6 scroll-mt-28">
              {badges.length > 0 && (
                <div className="mb-3 flex flex-wrap gap-2">
                  {badges.map((b, i) => (
                    <AlphaBadge key={i} variant={b.variant} label={b.label} value={b.value} />
                  ))}
                </div>
              )}
              <div className="mb-2 flex items-start justify-between gap-3">
                <h1 className="text-2xl font-bold text-slate-100">{address}</h1>
                {/* Prominent save — top of the detail so it's reachable without
                    scrolling past the entire financial workup (mirrors the dashboard). */}
                <WatchButton
                  item={{
                    listing_key: id,
                    address,
                    city: detail.city ?? undefined,
                    list_price: price,
                    thumb: detail.media_urls[0],
                  }}
                  label="Save"
                  className="min-h-[44px] shrink-0 md:min-h-0"
                />
              </div>
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                {status.kind === "sold" ? (
                  <>
                    <span className="rounded bg-rose-500/15 px-2 py-0.5 font-mono text-sm font-bold tracking-wider text-rose-400">
                      {status.label}
                      {soldDate ? ` ${fmtDate(soldDate)}` : ""}
                    </span>
                    {soldPrice ? (
                      <>
                        <span className="font-mono text-3xl font-bold text-emerald-400">
                          {formatPrice(soldPrice)}
                        </span>
                        {price > 0 && (
                          <>
                            <span className="font-mono text-lg text-slate-500 line-through">
                              {formatPrice(price)}
                            </span>
                            <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-xs text-slate-300">
                              {((soldPrice / price) * 100).toFixed(1)}% of ask
                            </span>
                          </>
                        )}
                      </>
                    ) : (
                      <>
                        <span className="font-mono text-3xl font-bold text-slate-400">
                          {formatPrice(price)}
                        </span>
                        {hasSoldPrice && (
                          <Link
                            href="/login"
                            className="rounded border border-slate-700 px-2 py-0.5 text-xs text-cyan-300 hover:bg-slate-800"
                          >
                            Sign in for the sold price
                          </Link>
                        )}
                      </>
                    )}
                  </>
                ) : status.kind === "delisted" ? (
                  <>
                    <span className="rounded bg-amber-500/15 px-2 py-0.5 font-mono text-sm font-bold tracking-wider text-amber-400">
                      OFF MARKET
                    </span>
                    <span className="font-mono text-3xl font-bold text-slate-400">
                      {formatPrice(price)}
                    </span>
                  </>
                ) : (
                  <span className="font-mono text-3xl font-bold text-emerald-400">
                    {formatPrice(price)}
                  </span>
                )}
                <span className="text-sm text-slate-500">
                  {p.City}
                  {p.PropertySubType ? `, ${p.PropertySubType}` : ""}
                </span>
                {isActiveListing && (
                  <span className="text-sm font-semibold text-slate-400">
                    Listed {dom} {dom === 1 ? "day" : "days"} ago
                  </span>
                )}
                {status.kind === "sold" && (
                  <span className="text-sm font-semibold text-slate-400">
                    Sold after {dom} {dom === 1 ? "day" : "days"} on market
                  </span>
                )}
                {isActiveListing && (
                  <DealScoreBadge
                    score={view.dealScore.personaScores?.[lens]?.score ?? view.dealScore.score}
                    grade={view.dealScore.personaScores?.[lens]?.grade ?? view.dealScore.grade}
                  />
                )}
              </div>
              {status.kind === "delisted" && (
                <p className="mt-1 text-sm text-amber-300/80">
                  {status.mlsStatus
                    ? [
                        `${status.mlsStatus}${status.delistedDate ? ` ${fmtDate(status.delistedDate)}` : ""}`,
                        status.daysOnMarket != null ? `${status.daysOnMarket} days on market` : null,
                        status.lastListPrice ? `last asking ${formatPrice(status.lastListPrice)}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")
                    : "This listing is no longer on the market."}
                </p>
              )}
              {p.ListOfficeName && (
                <p className="mt-2 flex items-center gap-1.5 text-sm text-slate-400">
                  <Building2 className="h-4 w-4 text-slate-500" />
                  Listed by {p.ListOfficeName}
                </p>
              )}
            </div>

            {/* The Read — synthesized, persona-aware verdict (deterministic, §4-safe) */}
            {isActiveListing && <TheReadCard read={buildTheRead(view, diligenceFlags)} defaultPersona={lens} />}

            {/* Social proof — honest, deterministic activity counters */}
            <SocialProofBar listingId={id} className="mb-6" />

            {/* Gallery */}
            <div className="mb-6">
              <PropertyGallery images={detail.media_urls} />
            </div>

            {/* Specs */}
            <div className="mb-6 grid grid-cols-4 gap-3">
              <SpecCell icon={<Bed className="h-5 w-5 text-emerald-400" />} value={bedsLabel(p) ?? (p.BedroomsTotal ?? 0)} label="Beds" />
              <SpecCell icon={<Bath className="h-5 w-5 text-cyan-400" />} value={p.BathroomsTotalInteger ?? 0} label="Baths" />
              <SpecCell
                icon={<Square className="h-5 w-5 text-purple-400" />}
                value={p.BuildingAreaTotal ? p.BuildingAreaTotal.toLocaleString() : "N/A"}
                label="Sqft"
              />
              <SpecCell icon={<Car className="h-5 w-5 text-amber-400" />} value={p.ParkingTotal ?? p.CoveredSpaces ?? 0} label="Parking" />
            </div>

            {/* Property Data Sheet — full TRREB payload, registry-driven (spec 2026-06-12) */}
            <div id="details" className="scroll-mt-28">
              <PropertyDataSheet groups={datasheet} />
            </div>

            {/* Things to Know — interpretive diligence flags (sourced; §4-safe) */}
            <ThingsToKnowCard flags={diligenceFlags} />

            {/* Schools */}
            <NearbySchools listingId={id} />

            {/* Grocery + recreation proximity */}
            <NearbyAmenities listingId={id} />

            {/* Room Dimensions — proportional, drawn-to-scale room map */}
            {rooms.length > 0 && (
              <div id="rooms" className="scroll-mt-28">
                <RoomMap rooms={rooms} className="mb-6" />
              </div>
            )}

            {/* Remarks */}
            <Section title="Unvarnished Remarks" icon={<AlertTriangle className="h-4 w-4 text-amber-400" />}>
              <div className="rounded-lg border border-slate-800 bg-slate-900/30 p-4">
                <ClampText
                  text={p.PublicRemarks || "No remarks available."}
                  className="text-sm leading-relaxed text-slate-300"
                />
              </div>
            </Section>

            {/* Brokerage (mandatory display) */}
            <Section title="Listed By" icon={<Building2 className="h-4 w-4 text-emerald-400" />}>
              <p className="text-sm text-slate-300">
                {p.ListOfficeName || "Brokerage information not available"}
              </p>
            </Section>

            {/* Your Take — private note + personal deal-breaker auto-screen (client, localStorage) */}
            <YourTakeCard
              listingKey={id}
              isLease={isLease}
              metrics={{
                listPrice: price || null,
                capRatePct: view.capRatePct,
                beds: p.BedroomsTotal ?? null,
                trueDom,
              }}
            />
          </div>

          {/* ── RIGHT (30%, sticky) ── */}
          <div id="financials" className="scroll-mt-28">
            <div className="sticky top-6 space-y-4">
              {/* The financial cards below (sold-accuracy receipt, Deal Score, Estimated
                  Sale Price / True Value, Force Appreciation) are all AVM-derived and assume
                  a SALE. They're gated off on LEASE listings, where ListPrice is the monthly
                  rent — estimating, scoring, or force-appreciating a sale value there is a
                  fabrication. The RentalSnapshot below is the lease's financial card instead. */}

              {/* Sold: lead with the accuracy receipt — Deal Score / Expected Sale are
                  for live asks; their job here is done. */}
              {status.kind === "sold" && !isLease && (
                <SoldOutcomeCard
                  accuracy={soldAccuracy}
                  soldDate={soldDate}
                  locked={!isAuthed && hasSoldAccuracy}
                />
              )}

              {isActiveListing && !isLease && (
                <DealScoreCard dealScore={view.dealScore} locked={!isAuthed && hasDealScore} initialPersona={lens} />
              )}

              {!isLease && (isActiveListing ? (
                /* ONE number: the Estimated Sale Price (list-anchored where we can be,
                   AVM as fallback). The intrinsic AVM lives on as the faint "comparable
                   value" band inside this card + as the Deal Score signal above. */
                <EstimatedSaleCard
                  salePrice={salePrice}
                  listPrice={price}
                  city={p.City}
                  propertySubType={p.PropertySubType}
                  locked={!isAuthed && (hasEstimate || hasExpectedSale)}
                />
              ) : status.kind === "sold" && hasSoldAccuracy ? (
                /* Sold WITH a receipt: the "Our Call vs. The Sale" card above IS the single
                   number. Don't also show a standalone True Value — that was the confusing
                   second estimate the user flagged. */
                null
              ) : (
                /* Delisted/off-market, or sold without a receipt: the independent True
                   Value is the only number we can offer (no live ask to anchor to). */
                <ListingEstimateCard
                  estimate={view.estimate}
                  listPrice={price}
                  cityRegion={p.CityRegion}
                  city={p.City}
                  locked={!isAuthed && hasEstimate}
                  hideAskDelta={status.kind === "sold"}
                />
              ))}

              {/* Force-Appreciation — renovation ROI from the Value-Add Engine */}
              {!isLease && (
                <ForceAppreciationCard report={view.valueAdd} locked={!isAuthed && hasValueAdd} />
              )}

              {/* Compliance disclaimer for the AVM-derived figures above (estimate + value-add) */}
              {!isLease && ((salePrice?.value ?? 0) > 0 || (view.estimate?.estimatedValue ?? 0) > 0) && (
                <Disclaimers />
              )}

              {/* Asset Summary */}
              <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-200">
                  Asset Summary
                </h3>
                <div className="space-y-2 text-xs">
                  {soldPrice !== null && (
                    <SummaryRow
                      label={status.kind === "sold" && status.label === "LEASED" ? "Leased Price" : "Sold Price"}
                      value={formatPrice(soldPrice)}
                      valueClass="text-rose-400"
                    />
                  )}
                  <SummaryRow
                    label={isLease ? "Monthly Rent" : "List Price"}
                    value={formatPrice(price)}
                    valueClass={isActiveListing ? "text-emerald-400" : "text-slate-400"}
                  />
                  <SummaryRow
                    label="Annual Taxes"
                    value={p.TaxAnnualAmount ? formatPrice(p.TaxAnnualAmount) : "N/A"}
                  />
                  <SummaryRow
                    label="Monthly Fees"
                    value={p.AssociationFee ? formatPrice(p.AssociationFee) : "None"}
                  />
                  <SummaryRow
                    label="True DOM"
                    value={`${trueDom} days`}
                    valueClass={trueDom > 45 ? "text-emerald-400" : trueDom >= 14 ? "text-amber-400" : "text-slate-400"}
                  />
                </div>
              </div>

              {isLease ? (
                <RentalSnapshot
                  monthlyRent={soldPrice ?? price}
                  leased={status.kind === "sold"}
                  buildingAreaTotal={p.BuildingAreaTotal ?? null}
                  livingAreaRange={p.LivingAreaRange ?? null}
                  leaseTerm={p.LeaseTerm ?? null}
                  depositRequired={p.DepositRequired ?? null}
                  rentIncludes={p.RentIncludes ?? null}
                />
              ) : (
                <UnderwritingSandbox
                  listingId={id}
                  listPrice={soldPrice ?? price}
                  annualTaxes={p.TaxAnnualAmount || 0}
                  monthlyFees={p.AssociationFee || 0}
                  hasSuitePotential={hasSuitePotential}
                  incomeApplicable={incomeApplicable}
                />
              )}

              {/* Property History (timeline + campaign/sale tables) moved to the full-width band below the grid. */}
              <CondoFeeStabilityCard feeStability={detail.feeStability} />

              <ListingActions
                id={id}
                address={address}
                city={detail.city ?? undefined}
                price={price}
                thumb={detail.media_urls[0]}
                statusKind={status.kind}
              />
            </div>
          </div>
        </div>

        {/* ── FULL-WIDTH: Property History — timeline + campaign/sale tables, given room out of the 30% rail ── */}
        <section id="history" className="mt-6 scroll-mt-28">
          {/* Mobile: collapse this tall band behind a tap. Pure CSS (a peer
              checkbox), so it stays server-rendered — no client boundary, no
              hydration flash. Desktop (md+) always shows it and hides the toggle. */}
          <input type="checkbox" id="history-toggle" className="peer sr-only" tabIndex={-1} aria-hidden="true" />
          <label
            htmlFor="history-toggle"
            className="flex min-h-[44px] cursor-pointer select-none items-center justify-between gap-2 border-t border-slate-800 py-3 peer-checked:[&_svg]:rotate-180 md:hidden"
          >
            <span className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-slate-100">
              Property History
            </span>
            <ChevronDown className="h-4 w-4 shrink-0 text-slate-400 transition-transform" />
          </label>
          <div className="hidden peer-checked:block md:block">
          {isAuthed && view.campaignHistory.events.length > 0 ? (
            <CampaignHistoryChart
              events={view.campaignHistory.events}
              trueDom={view.campaignHistory.trueDom}
              campaignCount={view.campaignHistory.campaignCount}
              nowMs={nowMs}
            />
          ) : (
            <DOMTimelineChart
              currentPrice={price}
              originalPrice={view.priceTimeline.originalPrice ?? undefined}
              priceDrop={view.priceTimeline.totalPriceDrop}
              dom={trueDom}
              saleMarkers={saleMarkers}
            />
          )}
          {saleHistory.saleCount > 0 ? (
            <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
              <CampaignHistorySection campaignHistory={view.campaignHistory} isAuthed={isAuthed} />
              <SaleHistorySection saleHistory={saleHistory} isAuthed={isAuthed} />
            </div>
          ) : (
            <CampaignHistorySection className="mt-4" campaignHistory={view.campaignHistory} isAuthed={isAuthed} />
          )}
          </div>
        </section>

        {/* ── Comparable Properties (For Sale + Recently Sold), lazy client island ── */}
        <div id="comps" className="scroll-mt-28">
        <SimilarProperties
          subjectId={id}
          cityRegion={p.CityRegion ?? null}
          city={p.City ?? null}
          subType={p.PropertySubType ?? null}
          beds={p.BedroomsTotal ?? 0}
          bedsAbove={p.BedroomsAboveGrade ?? 0}
          bedsBelow={p.BedroomsBelowGrade ?? 0}
          garage={p.CoveredSpaces ?? null}
          baths={p.BathroomsTotalInteger ?? 0}
          listPrice={price}
          area={p.BuildingAreaTotal ?? 0}
        />
        </div>

        {/* IDX consumer notice — unconditional on every listing page (§6.3(i)+(k)),
            independent of whether AVM figures rendered above. */}
        <ListingComplianceNotice className="mt-8" />
      </div>

      {/* Mobile sticky Save + Contact — the right rail (with these actions) stacks
          far below the fold on phones; this keeps the funnel reachable. */}
      <MobileActionBar
        item={{
          listing_key: id,
          address,
          city: detail.city ?? undefined,
          list_price: price,
          thumb: detail.media_urls[0],
        }}
        listingKey={id}
        canContact={isActiveListing}
      />
    </main>
  );
}

function SpecCell({ icon, value, label }: { icon: React.ReactNode; value: React.ReactNode; label: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3 text-center">
      <div className="mx-auto mb-1 flex justify-center">{icon}</div>
      <span className="block font-mono text-lg font-bold text-slate-200">{value}</span>
      <span className="block text-[10px] uppercase text-slate-500">{label}</span>
    </div>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-6">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-slate-200">
        {icon}
        {title}
      </h3>
      {children}
    </div>
  );
}

function SummaryRow({
  label,
  value,
  valueClass = "text-slate-300",
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex justify-between">
      <span className="text-slate-500">{label}</span>
      <span className={cn("font-mono", valueClass)}>{value}</span>
    </div>
  );
}
