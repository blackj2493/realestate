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
import { cookies } from "next/headers";
import { Bed, Bath, Square, Car, Layers, FileText, Building2, ChevronDown, Clock, Lock } from "lucide-react";
import { cn, formatPrice } from "@/lib/utils";
import { gateVowDerived } from "@/lib/property/getListingDetail";
import { getListingDetailCached } from "@/lib/property/getListingDetailCached";
import { isDemoListingKey } from "@/lib/demo/demoListing";
import { isCommercialProperty } from "@/lib/filters/fundamentals";
import { buildListingPath, cityHubSlug, cityHubResolves } from "@/lib/listings/listingPath";
import { resolveSalePrice } from "@/lib/avm/salePrice";
import { bedsLabel } from "@/lib/listings/bedsLabel";
import { basementLabel } from "@/lib/listings/basementLabel";
import { shouldRender as hasValueAddData } from "@/components/Property/forceAppreciationView";
import { getConsumer } from "@/lib/auth/requireConsumer";
import { logVowAccess } from "@/lib/audit/vowAccessLog";
import { AlphaBadge, detectPropertyBadges } from "@/components/CommandCenter/AlphaBadge";
import ListingCalculator from "@/components/Property/ListingCalculator";
import { getCurrentMortgageRate } from "@/lib/finance/getMortgageRate";
import RentalSnapshot from "@/components/Property/RentalSnapshot";
import RentalGlance from "@/components/Property/RentalGlance";
import CommercialLeaseSnapshot from "@/components/Property/CommercialLeaseSnapshot";
import { classifyLeaseBasis, buildRentalGlance } from "@/lib/property/rentalSnapshot";
import ZoningCard from "@/components/Property/ZoningCard";
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
import ListingAlertCapture from "@/components/Property/ListingAlertCapture";
import IntelligencePanel from "@/components/Property/IntelligencePanel";
import TheReadCard from "@/components/Property/TheReadCard";
import { buildTheRead } from "@/lib/property/theRead";
import { resolvePersona } from "@/lib/personas/resolvePersona";
import { LENS_COOKIE } from "@/lib/personas/lensPersistence";
import WatchButton from "@/components/watchlist/WatchButton";
import MobileActionBar from "./MobileActionBar";
import PropertyGallery from "./PropertyGallery";
import RecordView from "./RecordView";
import ListingActions from "./ListingActions";
import { Suspense } from "react";
import NearbySchools from "./NearbySchools";
import NearbyAmenities from "./NearbyAmenities";
import TypicalRents from "./TypicalRents";
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
 * Path to this listing's city hub (/property/{prov}/{city} — or the commercial tree's
 * /commercial/{prov}/{city} for Commercial-class listings, whose inventory the
 * residential hubs exclude), or null when the hub wouldn't resolve (district-split
 * cities like Toronto/London — see cityHubResolves; they come online with 2b-ii's
 * CitySlug). Drives the breadcrumb crawl-link + JSON-LD.
 */
function cityHubPath(
  p: { City?: string; StateOrProvince?: string },
  commercial = false
): string | null {
  if (!p.City || !cityHubResolves(p.City)) return null;
  return `/${commercial ? "commercial" : "property"}/${(p.StateOrProvince || "ON").toLowerCase()}/${cityHubSlug(p.City)}`;
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
  // MLS zoning — agent-entered; sampled fill on commercial is ~1%, so the hero cell
  // falls back to PropertyUse ("Industrial Condo", "Without Property"), which the
  // feed fills reliably on Commercial-class listings.
  Zoning?: string;
  PropertyUse?: string;
  // Zoning — municipal open data (harvest-populated); shown via the attributed ZoningCard.
  zoning_designation?: string;
  zoning_desc?: string;
  zoning_source?: string;
  BuildingAreaTotal?: number;
  // Unit for BuildingAreaTotal — "Square Feet", "Acres", "Square Metres". Area math
  // ($/sqft) and the hero label must respect it; sqft may only be ASSUMED when absent.
  BuildingAreaUnits?: string;
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
  // Commercial lease/tax quote semantics (commercial-gap Phase 1): ListPriceUnit is
  // the price basis ("Month", "Per Sq Ft", "Year", "For Sale"); TaxType="TMI" means
  // TaxAnnualAmount carries the TMI figure, not an annual property tax.
  ListPriceUnit?: string;
  TaxType?: string | string[];
  TMI?: string;
}

function calculateDaysOnMarket(ts?: string): number {
  if (!ts) return 0;
  const diff = Date.now() - new Date(ts).getTime();
  return Math.max(0, Math.ceil(diff / 86_400_000) - 1);
}

/** Format a feed date; malformed strings pass through raw instead of "Invalid Date".
 *  Feed dates are date-only strings that parse as UTC midnight — without timeZone:'UTC'
 *  Ontario viewers see the previous day (audit MEDIUM-18). */
function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

function cleanDescription(remarks: string | undefined, max = 155): string {
  if (!remarks) return "";
  const flat = remarks.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** An http(s) URL from a raw payload value, else null (defence vs feed garbage). */
function httpUrlOrNull(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return /^https?:\/\//i.test(s) ? s : null;
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
  // Commercial has no beds/baths — the residential fallback would fabricate
  // "0 bed, 0 bath Office" (commercial-gap Phase 0).
  const fallbackDescription = isCommercialProperty(p.PropertyType)
    ? `${address}. ${p.PropertySubType || "Commercial property"} listed at ${formatPrice(price)}.`
    : `${address}. ${p.BedroomsTotal ?? 0} bed, ${p.BathroomsTotalInteger ?? 0} bath ${
        p.PropertySubType || "home"
      } listed at ${formatPrice(price)}.`;
  const description = cleanDescription(p.PublicRemarks) || fallbackDescription;
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
  // Commercial-class listings are NOT accommodations — schema.org has no commercial
  // real-estate subtype, so they get a plain Place node (no beds/baths/rooms) rather
  // than lying to crawlers with SingleFamilyResidence (commercial-gap Phase 0).
  const isCommercial = isCommercialProperty(p.PropertyType);
  const accommodationType = isCommercial
    ? "Place"
    : /condo|apartment/.test(subType)
      ? "Apartment"
      : "SingleFamilyResidence";
  const url = listingCanonical(id, p);
  const cityPath = cityHubPath(p, isCommercial);
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
    // Residential leases are always monthly; commercial leases carry their quote
    // basis in ListPriceUnit — a $22/sqft/yr ask must not be emitted as $22/month.
    ...(isLease && isCommercial ? { leaseBasis: classifyLeaseBasis(p.ListPriceUnit) } : {}),
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
        // Room/bed/bath counts + floorSize are Accommodation properties; a plain
        // commercial Place carries only name/address/offer.
        ...(isCommercial
          ? {}
          : {
              numberOfRooms: p.RoomsTotal || detail.rooms.length || undefined,
              numberOfBedrooms: p.BedroomsTotal || undefined,
              numberOfBathroomsTotal: p.BathroomsTotalInteger || undefined,
              ...(p.BuildingAreaTotal
                ? { floorSize: { "@type": "QuantitativeValue", value: p.BuildingAreaTotal, unitCode: "FTK" } }
                : {}),
            }),
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
  // Persona lens: ?lens= (carried from the terminal) wins, else the pp_lens cookie a
  // previous chip click persisted (see lensPersistence.ts), else the Homebuyer default.
  // The page is already force-dynamic (VOW gating), so reading cookies costs nothing.
  const { lens: lensParam } = await searchParams;
  const cookieStore = await cookies();
  const lens = resolvePersona("detail", {
    url: lensParam,
    persisted: cookieStore.get(LENS_COOKIE)?.value,
  });
  const detail = await getListingDetailCached(id).catch(() => null);

  if (!detail) {
    return (
      <main className="min-h-app bg-background">
        <PropertyNotFound id={id} />
      </main>
    );
  }

  // VOW gating: strip sold prices/dates AND VOW-derived metrics (AVM, Value-Add,
  // Deal Score, stitched True DOM) for anonymous users — the numbers never reach the
  // client; the cards render blurred "Login Required" teasers (§4; §6.2(f)). The
  // has* flags (computed from the ungated detail) drive the teaser only where real
  // data exists, so we never tease an empty card.
  // Synthetic PPDEMO fixtures render ungated (their "VOW" numbers are fabricated —
  // see src/lib/demo/demoListing.ts); impossible outside DEMO_FIXTURES=1 dev runs.
  // VOW gate is CONSUMER-level (signed in AND accepted the VOW Terms), not mere login —
  // matches every other VOW surface (APIs, /address, dashboard). A logged-in user who has
  // not accepted the Terms sees the same teaser as anon until they do.
  const { user: consumer, isConsumer } = await getConsumer();
  const isAuthed = isDemoListingKey(id) || isConsumer;
  // VOW §5.4: record the consumer's access to this listing's VOW data (never demo fixtures).
  if (isConsumer && consumer) await logVowAccess(consumer.id, `listing:${id}`);
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
  // Commercial-gap Phase 0: everything AVM/persona-derived on this page (Deal Score,
  // Estimated Sale, Renovation Upside, The Read, schools, beds/baths hero) is built
  // for dwellings. Commercial-class listings arrive here via organic search (the
  // sitemap emits all listings), so gate the residential machinery instead of
  // rendering fabricated numbers on an office/retail/industrial asset. Computed
  // before cityHref so the breadcrumb routes into the commercial hub tree (Phase 2).
  const isCommercial = isCommercialProperty(p.PropertyType);
  const cityHref = cityHubPath(p, isCommercial);
  // BuildingAreaTotal in SQFT, or null when the feed quotes another unit (Acres,
  // Square Metres — common on commercial/land). Everything that does per-sqft math
  // (lease snapshots, comps area scoring) must consume THIS, never the raw field.
  const areaSqftOrNull =
    p.BuildingAreaTotal && (!p.BuildingAreaUnits || /feet|ft/i.test(p.BuildingAreaUnits))
      ? p.BuildingAreaTotal
      : null;
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
  // only rather than inventing a rent. Commercial is gated for the same reason —
  // belt-and-braces with the subtype patterns inside isIncomeProperty.
  const incomeApplicable = !isCommercial && isIncomeProperty(p.PropertySubType);
  // For-Lease listings carry the monthly rent in ListPrice, not a purchase price, so
  // the buy-and-hold Underwriting Sandbox can only fabricate (a $540 down payment, a
  // 516% cap rate). Detect the lease and show a Rental Snapshot instead. Same criterion
  // datasheet.ts uses to gate the Lease Terms group (§6.3(f)).
  const isLease = /lease/i.test(p.TransactionType ?? "");
  // Rental-at-a-glance facts (portion/pets/furnished/laundry/availability/payment) —
  // public IDX fields, so the gated payload carries them for anon too. Residential
  // leases only; commercial leases get the basis-aware CommercialLeaseSnapshot instead.
  const rentalGlance = isLease && !isCommercial ? buildRentalGlance(view.full_payload) : null;
  const jsonLd = buildJsonLd(id, detail);
  // Calculator geography + rate seed. TRREB encodes the City of Toronto as
  // district codes ("Toronto C01".."W10"), all prefixed "Toronto", so a
  // word-boundary prefix flags the MLTT-levying municipality; LTT itself is an
  // Ontario concept, so cash-to-close only surfaces for ON.
  const provinceCode = (p.StateOrProvince || "ON").trim().toUpperCase();
  const isOntario = provinceCode === "ON" || provinceCode === "ONTARIO";
  const isToronto = /^toronto\b/i.test(p.City ?? "");
  // Live 5-yr-fixed seed (Bank-of-Canada refreshed nightly job; cached, fallback-safe).
  const mortgageRate = await getCurrentMortgageRate();
  // Which lens opens first: investor personas → the underwrite; the Homebuyer
  // default (and non-income parcels) → the buyer view.
  const calcDefaultLens: "buyer" | "investor" = incomeApplicable && lens !== "smart" ? "investor" : "buyer";

  // Suite-potential / school-zone / surplus-parking badges are dwelling-investor
  // signals — an office isn't an "income suite" — so commercial shows none, matching
  // the Quick Look drawer's gating.
  const badges = isCommercial
    ? []
    : detectPropertyBadges({
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
  // Virtual tour — surfaced as a badge on the gallery (high-intent) rather than buried
  // in the data sheet. Prefer the unbranded (IDX-safe) URL; fall back to the branded one.
  const vp = view.full_payload as Record<string, unknown>;
  const tourUrl = httpUrlOrNull(vp.VirtualTourURLUnbranded) ?? httpUrlOrNull(vp.VirtualTourURLBranded);
  // Things to Know — payload-derived diligence flags (Phase 1) merged with
  // geo-joined public-records flags (Phase 2: flood/rail/traffic). Public data is
  // not VOW-gated, so view.geoFlags is populated for anon users too. Feeds The Read.
  const diligenceFlags = buildDiligenceFlags(view.full_payload, view.geoFlags);

  // Mobile section jumper — matches the zoned mobile scroll order (the Numbers
  // panel sits second); ids are shared with the desktop layout's anchors.
  const navSections = [
    { id: "overview", label: "Overview" },
    { id: "numbers", label: "Numbers" },
    { id: "details", label: "Details" },
    ...(rooms.length > 0 ? [{ id: "rooms", label: "Rooms" }] : []),
    { id: "history", label: "History" },
    { id: "comps", label: "Comps" },
  ];

  // The consolidated Intelligence panel replaces the stacked analysis cards for
  // the standard case (active residential sale). Sold / lease / commercial keep
  // the legacy card stack — their card set differs too much to tab identically.
  const panelEligible = isActiveListing && !isCommercial && !isLease;
  const read = panelEligible ? buildTheRead(view, diligenceFlags) : null;
  // The lite-tier nudge sentence is appended to thesis AND priceRead — the
  // panel has ONE gate strip instead, so strip the duplicated pitch here.
  const stripNudge = (s: string) =>
    s.replace(" Sign in for our price estimate, Deal Score and reno-upside read.", "");

  // Asset/Rental summary + finance card render in the rail (legacy path) or
  // inside the panel's Costs tab (panel path) — defined once, used in one spot.
  const assetSummaryCard = (
    <div className="rounded-lg border border-border bg-card/50 p-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-foreground">
        {isLease ? "Rental Summary" : "Asset Summary"}
      </h3>
      <div className="space-y-2 text-xs">
        {soldPrice !== null && (
          <SummaryRow
            label={status.kind === "sold" && status.label === "LEASED" ? "Leased Price" : "Sold Price"}
            value={formatPrice(soldPrice)}
            valueClass="text-rose-700 dark:text-rose-400"
          />
        )}
        <SummaryRow
          label={
            isLease
              ? isCommercial && p.ListPriceUnit && !/month/i.test(p.ListPriceUnit)
                ? `Asking Rent (${p.ListPriceUnit})`
                : "Monthly Rent"
              : "List Price"
          }
          value={formatPrice(price)}
          valueClass={isActiveListing ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}
        />
        {(!isLease || isCommercial) && (
          <>
            <SummaryRow
              label={
                isCommercial && typeof p.TaxType === "string" && p.TaxType.trim().toUpperCase() === "TMI"
                  ? "TMI (as listed)"
                  : "Annual Taxes"
              }
              value={p.TaxAnnualAmount ? formatPrice(p.TaxAnnualAmount) : "N/A"}
            />
            <SummaryRow
              label="Monthly Fees"
              value={p.AssociationFee ? formatPrice(p.AssociationFee) : "None"}
            />
          </>
        )}
        <SummaryRow
          label={isLease ? "Days Available" : "True DOM"}
          value={`${trueDom} days`}
          valueClass={trueDom > 45 ? "text-emerald-700 dark:text-emerald-400" : trueDom >= 14 ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}
        />
      </div>
    </div>
  );

  const financeCard = isLease ? (
    isCommercial ? (
      <CommercialLeaseSnapshot
        listPrice={soldPrice ?? price}
        listPriceUnit={p.ListPriceUnit ?? null}
        buildingAreaTotal={areaSqftOrNull}
        leaseTerm={p.LeaseTerm ?? null}
        rentIncludes={p.RentIncludes ?? null}
        tmi={p.TMI ?? null}
        taxType={typeof p.TaxType === "string" ? p.TaxType : null}
        taxAnnualAmount={p.TaxAnnualAmount ?? null}
        leased={status.kind === "sold"}
      />
    ) : (
      <RentalSnapshot
        monthlyRent={soldPrice ?? price}
        leased={status.kind === "sold"}
        buildingAreaTotal={areaSqftOrNull}
        livingAreaRange={p.LivingAreaRange ?? null}
        leaseTerm={p.LeaseTerm ?? null}
        depositRequired={p.DepositRequired ?? null}
        rentIncludes={p.RentIncludes ?? null}
      />
    )
  ) : (
    <ListingCalculator
      listingId={id}
      listPrice={soldPrice ?? price}
      annualTaxes={p.TaxAnnualAmount || 0}
      monthlyFees={p.AssociationFee || 0}
      hasSuitePotential={hasSuitePotential}
      incomeApplicable={incomeApplicable}
      isToronto={isToronto}
      isOntario={isOntario}
      initialRatePct={mortgageRate.ratePct}
      rateAsOf={mortgageRate.asOf}
      defaultLens={calcDefaultLens}
    />
  );

  return (
    <main className="min-h-app bg-background text-foreground">
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
        <nav className="mb-4 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
          <Link href="/properties" className="text-cyan-700 dark:text-cyan-400 transition-colors hover:text-cyan-300">
            Command Center
          </Link>
          {cityHref && p.City && (
            <>
              <span aria-hidden>/</span>
              <Link href={cityHref} className="text-cyan-700 dark:text-cyan-400 transition-colors hover:text-cyan-300">
                {isCommercial ? `Commercial properties in ${p.City}` : `Homes for sale in ${p.City}`}
              </Link>
            </>
          )}
        </nav>

        <DetailMobileNav sections={navSections} />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[7fr_3fr]">
          {/* ── LEFT: THE HOME zone — the property itself, before any analysis. ── */}
          <div id="home" className="scroll-mt-28 lg:col-start-1 lg:row-start-1">
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
                <h1 className="text-2xl font-bold text-foreground">{address}</h1>
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
                    <span className="rounded bg-rose-500/15 px-2 py-0.5 font-mono text-sm font-bold tracking-wider text-rose-700 dark:text-rose-400">
                      {status.label}
                      {soldDate ? ` ${fmtDate(soldDate)}` : ""}
                    </span>
                    {soldPrice ? (
                      <>
                        <span className="font-mono text-3xl font-bold text-emerald-700 dark:text-emerald-400">
                          {formatPrice(soldPrice)}
                        </span>
                        {price > 0 && (
                          <>
                            <span className="font-mono text-lg text-muted-foreground line-through">
                              {formatPrice(price)}
                            </span>
                            <span className="rounded bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">
                              {((soldPrice / price) * 100).toFixed(1)}% of ask
                            </span>
                          </>
                        )}
                      </>
                    ) : (
                      <>
                        {/* Anon: the ask is NOT the closing number — strike it through
                            (the authed view already does once the sold price shows),
                            and give the sign-in gate real CTA weight. */}
                        <span className="font-mono text-3xl font-bold text-muted-foreground line-through decoration-2">
                          {formatPrice(price)}
                        </span>
                        {hasSoldPrice && (
                          <Link
                            href="/login"
                            className="inline-flex min-h-[40px] items-center gap-1.5 self-center rounded-lg border border-cyan-500 bg-cyan-500/10 px-4 text-sm font-bold text-cyan-700 transition-colors hover:bg-cyan-500/20 dark:text-cyan-300"
                          >
                            <Lock className="h-4 w-4" />
                            Sign in for the {status.label === "LEASED" ? "leased" : "sold"} price — free
                          </Link>
                        )}
                      </>
                    )}
                  </>
                ) : status.kind === "delisted" ? (
                  <>
                    <span className="rounded bg-amber-500/15 px-2 py-0.5 font-mono text-sm font-bold tracking-wider text-amber-700 dark:text-amber-400">
                      OFF MARKET
                    </span>
                    <span className="font-mono text-3xl font-bold text-muted-foreground">
                      {formatPrice(price)}
                    </span>
                  </>
                ) : (
                  <span className="font-mono text-3xl font-bold text-emerald-700 dark:text-emerald-400">
                    {formatPrice(price)}
                    {/* Commercial lease quotes carry a basis ("Per Sq Ft", "Month") —
                        a bare "$22" headline would read as a sale price. Verbatim unit. */}
                    {isCommercial && isLease && p.ListPriceUnit && !/for sale/i.test(p.ListPriceUnit) && (
                      <span className="ml-1.5 text-base font-semibold text-emerald-500/80">
                        {p.ListPriceUnit}
                      </span>
                    )}
                  </span>
                )}
                <span className="text-sm text-muted-foreground">
                  {p.City}
                  {p.PropertySubType ? `, ${p.PropertySubType}` : ""}
                </span>
                {isActiveListing && (
                  <span className="text-sm font-semibold text-muted-foreground">
                    Listed {dom} {dom === 1 ? "day" : "days"} ago
                  </span>
                )}
                {/* True DOM — our headline signal. Surfaced in the header ONLY when it
                    exceeds the current listing's age, i.e. the listing was re-posted to
                    reset its public days-on-market. The contrast with "Listed N days ago"
                    is the point. VOW-derived, so it self-hides for anon (trueDom → dom). */}
                {isActiveListing && trueDom > dom && (
                  <span
                    title={`This property has spent ${trueDom} days on market across all of its listings. The current listing is only ${dom} day${dom === 1 ? "" : "s"} old — it was re-listed, which resets the public days-on-market.`}
                    className={cn(
                      "inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-xs font-bold tracking-wide",
                      trueDom >= 90
                        ? "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300"
                        : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                    )}
                  >
                    <Clock className="h-3.5 w-3.5" />
                    True DOM {trueDom}d
                  </span>
                )}
                {/* Days-on-market for a SOLD listing is VOW-derived (how long the closed
                    campaign ran), so gate it behind auth — anon sees the SOLD badge but not
                    the sold DOM. Inherits the stronger consumer gate once isAuthed moves to
                    getConsumer(). */}
                {status.kind === "sold" && isAuthed && (
                  <span className="text-sm font-semibold text-muted-foreground">
                    Sold after {dom} {dom === 1 ? "day" : "days"} on market
                  </span>
                )}
                {isActiveListing && !isCommercial && !isLease && (
                  <DealScoreBadge
                    score={view.dealScore.personaScores?.[lens]?.score ?? view.dealScore.score}
                    grade={view.dealScore.personaScores?.[lens]?.grade ?? view.dealScore.grade}
                  />
                )}
              </div>

              {/* PROTOTYPE (Proposal B): hero scent — the moat one tap from the price.
                  Mobile-only (on desktop the Intelligence panel is already beside the
                  hero). VOW-safe: anon sees locked chips, never a number or direction. */}
              {panelEligible && (hasDealScore || hasEstimate || hasExpectedSale) && (
                <a
                  href="#numbers"
                  className="mt-3 inline-flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-cyan-500/30 bg-cyan-500/5 px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-cyan-500/10 lg:hidden"
                >
                  {hasDealScore && (
                    <span className="inline-flex items-center gap-1">
                      Deal grade
                      {isAuthed && (view.dealScore.personaScores?.[lens]?.grade ?? view.dealScore.grade) ? (
                        <span className="font-mono font-bold text-cyan-700 dark:text-cyan-300">
                          {view.dealScore.personaScores?.[lens]?.grade ?? view.dealScore.grade}
                        </span>
                      ) : (
                        <Lock className="h-3 w-3 text-muted-foreground" aria-label="locked" />
                      )}
                    </span>
                  )}
                  {(hasEstimate || hasExpectedSale) && (
                    <span className="inline-flex items-center gap-1">
                      Est. sale
                      {isAuthed && salePrice ? (
                        <span className="font-mono font-bold text-emerald-700 dark:text-emerald-400">
                          {formatPrice(salePrice.value)}
                        </span>
                      ) : (
                        <Lock className="h-3 w-3 text-muted-foreground" aria-label="locked" />
                      )}
                    </span>
                  )}
                  <span className="text-cyan-700 dark:text-cyan-400">Full analysis ↓</span>
                </a>
              )}
              {status.kind === "delisted" && (
                <p className="mt-1 text-sm text-amber-700 dark:text-amber-300/80">
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
                <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                  Listed by {p.ListOfficeName}
                </p>
              )}
            </div>

            {/* Gallery — leads the page: the photo is the universal triage hook (now above the
                verdict; social proof moved down to the action cluster in the rail). */}
            <div className="mb-6">
              <PropertyGallery images={detail.media_urls} tourUrl={tourUrl ?? undefined} />
            </div>

            {/* Specs — 3-up on mobile (wider cells so a long basement value wraps
                cleanly), 5-up from sm↑ where all stats sit on one row. Commercial swaps
                the dwelling stats (a warehouse is not "0 Beds / 0 Baths / Basement:
                None") for Sqft / Type / Zoning / Parking. */}
            {isCommercial ? (
              <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {/* Label honors BuildingAreaUnits — commercial/land area arrives in
                    Square Feet, ACRES or Square Metres; a hardcoded "Sqft" made a
                    16.41-acre Brampton parcel read as "16.41 Sqft" (43,000× off). */}
                <SpecCell
                  icon={<Square className="h-5 w-5 text-purple-400" />}
                  value={p.BuildingAreaTotal ? p.BuildingAreaTotal.toLocaleString() : "N/A"}
                  label={buildingAreaUnitLabel(p.BuildingAreaUnits)}
                />
                <SpecCell
                  icon={<Building2 className="h-5 w-5 text-emerald-700 dark:text-emerald-400" />}
                  value={p.PropertySubType || "Commercial"}
                  label="Type"
                />
                {/* MLS Zoning fill on commercial sampled at ~1%, so this cell degrades
                    Zoning → municipal harvest → PropertyUse (reliably filled) → N/A,
                    relabelling itself to match what it's actually showing. */}
                <SpecCell
                  icon={<FileText className="h-5 w-5 text-cyan-700 dark:text-cyan-400" />}
                  value={
                    p.Zoning?.trim() ||
                    p.zoning_designation?.trim() ||
                    p.PropertyUse?.trim() ||
                    "N/A"
                  }
                  label={
                    p.Zoning?.trim() || p.zoning_designation?.trim()
                      ? "Zoning"
                      : p.PropertyUse?.trim()
                        ? "Use"
                        : "Zoning"
                  }
                />
                <SpecCell icon={<Car className="h-5 w-5 text-amber-700 dark:text-amber-400" />} value={p.ParkingTotal ?? p.CoveredSpaces ?? 0} label="Parking" />
              </div>
            ) : (
            <div className="mb-6 grid grid-cols-3 gap-3 sm:grid-cols-5">
              <SpecCell icon={<Bed className="h-5 w-5 text-emerald-700 dark:text-emerald-400" />} value={bedsLabel(p) ?? (p.BedroomsTotal ?? 0)} label="Beds" />
              <SpecCell icon={<Bath className="h-5 w-5 text-cyan-700 dark:text-cyan-400" />} value={p.BathroomsTotalInteger ?? 0} label="Baths" />
              <SpecCell
                icon={<Square className="h-5 w-5 text-purple-400" />}
                value={
                  p.BuildingAreaTotal
                    ? p.BuildingAreaTotal.toLocaleString()
                    : // BuildingAreaTotal is ~never filled for houses; fall back to the
                      // TRREB LivingAreaRange band (e.g. "2500-3000") shown in the data sheet.
                      p.LivingAreaRange?.trim() || "N/A"
                }
                label="Sqft"
              />
              <SpecCell icon={<Car className="h-5 w-5 text-amber-700 dark:text-amber-400" />} value={p.ParkingTotal ?? p.CoveredSpaces ?? 0} label="Parking" />
              {/* Basement — promoted from the data sheet: walk-out/sep-entrance/apartment is the
                  rental-suite signal the investor personas key on. Raw TRREB value(s), "None" when empty. */}
              <SpecCell icon={<Layers className="h-5 w-5 text-indigo-700 dark:text-indigo-400" />} value={basementLabel(p)} label="Basement" />
            </div>
            )}

            {/* Rental at a glance — the facts a tenant scans for first, on residential
                leases. Takes The Read's slot here, since that verdict is buyer-oriented. */}
            {rentalGlance && <RentalGlance glance={rentalGlance} />}

            {/* Desktop keeps the prod layout: full verdict + diligence cards in the
                left column. Mobile carries both inside the Intelligence panel. */}
            <div className="hidden lg:block">
              {panelEligible && read && (
                <TheReadCard read={read} defaultPersona={lens} listingId={id} />
              )}
              <ThingsToKnowCard flags={diligenceFlags} geoChecked={view.geoChecked} address={address} listingId={id} />
            </div>
          </div>

          {/* ── RIGHT rail: THE NUMBERS zone — one Intelligence panel instead of six
               stacked analysis cards. Desktop col 2, sticky; renders SECOND on mobile,
               after the home itself. ── */}
          <div id="numbers" className="scroll-mt-28 lg:col-start-2 lg:row-start-1 lg:row-span-2">
            <div className="sticky top-6 space-y-4">
              <div className="lg:hidden"><ZoneLabel>The Numbers</ZoneLabel></div>
              {/* Legacy deep-link anchor (The Read evidence fallback, old inbound links). */}
              <div id="financials" className="scroll-mt-28" aria-hidden />

              {/* Desktop (prod layout): anon alert capture pinned to the rail top.
                  Mobile renders its own instance below the CTA cluster instead. */}
              {!isAuthed && (
                <div className="hidden lg:block">
                  <ListingAlertCapture
                    listingKey={id}
                    address={address}
                    city={detail.city ?? undefined}
                    statusKind={status.kind}
                  />
                </div>
              )}
              {/* The financial cards below (sold-accuracy receipt, Deal Score, Estimated
                  Sale Price / True Value, Force Appreciation) are all AVM-derived and assume
                  a SALE. They're gated off on LEASE listings, where ListPrice is the monthly
                  rent — estimating, scoring, or force-appreciating a sale value there is a
                  fabrication. The RentalSnapshot below is the lease's financial card instead. */}

              {/* Commercial: the whole AVM-derived stack below (sold-accuracy receipt,
                  Deal Score, Estimated Sale / True Value, Renovation Upside) is trained
                  on dwellings — suppressed rather than fabricated (commercial-gap Phase 0). */}

              {panelEligible && read ? (
                <>
                {/* MOBILE ONLY: the consolidated Intelligence panel.
                   Verdict = The Read compressed to three one-line rows (nudge
                   sentence stripped — the panel has ONE gate strip) + the full
                   diligence card. Price = estimate + reno upside. Score = Deal
                   Score. Costs = asset summary + calculator. Desktop keeps the
                   prod card stack below instead. */}
                <div className="lg:hidden">
                <IntelligencePanel
                  verdict={
                    <div>
                      <div className="divide-y divide-border/60">
                        <VerdictRow label="THESIS" tone="emerald" text={stripNudge(read.thesisByPersona[lens])} />
                        <VerdictRow label="THE CATCH" tone="amber" text={read.catch_} />
                        <VerdictRow label="PRICE READ" tone="cyan" text={stripNudge(read.priceRead)} />
                      </div>
                      <div className="mt-3">
                        <ThingsToKnowCard flags={diligenceFlags} geoChecked={view.geoChecked} address={address} listingId={id} />
                      </div>
                    </div>
                  }
                  price={
                    <div className="space-y-4">
                      <EstimatedSaleCard
                        salePrice={salePrice}
                        listPrice={price}
                        city={p.City}
                        propertySubType={p.PropertySubType}
                        locked={!isAuthed && (hasEstimate || hasExpectedSale)}
                      />
                      <ForceAppreciationCard report={view.valueAdd} locked={!isAuthed && hasValueAdd} />
                    </div>
                  }
                  score={
                    <DealScoreCard dealScore={view.dealScore} locked={!isAuthed && hasDealScore} initialPersona={lens} />
                  }
                  costs={
                    <div className="space-y-4">
                      {assetSummaryCard}
                      {financeCard}
                    </div>
                  }
                  footer={
                    !isAuthed ? (
                      <div className="mt-3 rounded-lg border border-dashed border-cyan-500/40 bg-cyan-500/5 p-3">
                        <p className="text-sm font-semibold text-foreground">One sign-in unlocks everything</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          Price estimate, Deal Score, sold prices &amp; full history. Free, ~20 seconds.
                        </p>
                        <Link
                          href="/login"
                          className="mt-2 inline-flex min-h-[38px] items-center rounded-lg border border-cyan-500 px-4 text-sm font-bold text-cyan-700 transition-colors hover:bg-cyan-500/10 dark:text-cyan-300"
                        >
                          Unlock this home
                        </Link>
                      </div>
                    ) : undefined
                  }
                />
                </div>

                {/* DESKTOP ONLY: the prod rail — same cards, same order as live. */}
                <div className="hidden space-y-4 lg:block">
                  <DealScoreCard dealScore={view.dealScore} locked={!isAuthed && hasDealScore} initialPersona={lens} />
                  <EstimatedSaleCard
                    salePrice={salePrice}
                    listPrice={price}
                    city={p.City}
                    propertySubType={p.PropertySubType}
                    locked={!isAuthed && (hasEstimate || hasExpectedSale)}
                  />
                  <ForceAppreciationCard report={view.valueAdd} locked={!isAuthed && hasValueAdd} />
                </div>
                </>
              ) : (
                <>
                  {/* Legacy stack (sold / lease / commercial): lead with the accuracy
                      receipt — Deal Score / Expected Sale are for live asks. */}
                  {status.kind === "sold" && !isLease && !isCommercial && (
                    <SoldOutcomeCard
                      accuracy={soldAccuracy}
                      soldDate={soldDate}
                      locked={!isAuthed && hasSoldAccuracy}
                    />
                  )}

                  {!isLease && !isCommercial && (status.kind === "sold" && hasSoldAccuracy ? (
                    /* Sold WITH a receipt: the "Our Call vs. The Sale" card above IS the
                       single number. */
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

                  {/* Renovation upside — Force-Appreciation ROI from the Value-Add Engine. */}
                  {!isLease && !isCommercial && (
                    <ForceAppreciationCard report={view.valueAdd} locked={!isAuthed && hasValueAdd} />
                  )}
                </>
              )}

              {/* Commit cluster — primary actions + honest social proof, kept HIGH and reachable
                  (actions were at the bottom of the rail; social proof was above the gallery). */}
              <ListingActions
                id={id}
                address={address}
                city={detail.city ?? undefined}
                price={price}
                thumb={detail.media_urls[0]}
                statusKind={status.kind}
                isLease={isLease}
              />
              <SocialProofBar listingId={id} isLease={isLease} />

              {/* MOBILE ONLY: anon email capture BELOW the Intelligence panel and
                  CTAs — the product's brain should never rank under an email field.
                  (Desktop's instance is pinned to the rail top, prod layout.) */}
              {!isAuthed && (
                <div className="lg:hidden">
                  <ListingAlertCapture
                    listingKey={id}
                    address={address}
                    city={detail.city ?? undefined}
                    statusKind={status.kind}
                  />
                </div>
              )}

              {/* Asset/Rental Summary + finance card: on mobile, panel-eligible
                  listings carry these inside the panel's Costs tab; desktop (and the
                  legacy stack) keeps them in the rail — the prod layout. */}
              {panelEligible ? (
                <div className="hidden space-y-4 lg:block">
                  {assetSummaryCard}
                  {financeCard}
                </div>
              ) : (
                <>
                  {assetSummaryCard}
                  {financeCard}
                </>
              )}

              {/* Compliance disclaimer for the AVM-derived figures (estimate + value-add) */}
              {!isLease && !isCommercial && ((salePrice?.value ?? 0) > 0 || (view.estimate?.estimatedValue ?? 0) > 0) && (
                <Disclaimers />
              )}

              {/* Property History (timeline + campaign/sale tables) lives in the full-width band below the grid. */}
              <CondoFeeStabilityCard feeStability={detail.feeStability} />
            </div>
          </div>

          {/* ── LEFT / row 2: THE HOME detail. Renders THIRD on mobile — after the
               Intelligence panel, so the moat sits one screen from the price. ── */}
          <div className="lg:col-start-1 lg:row-start-2">
            <div className="lg:hidden"><ZoneLabel>The Home</ZoneLabel></div>

            {/* Remarks (the listing's own description) */}
            <Section title="Listing Description" icon={<FileText className="h-4 w-4 text-cyan-700 dark:text-cyan-400" />}>
              <div className="rounded-lg border border-border bg-card/30 p-4">
                <ClampText
                  text={p.PublicRemarks || "No remarks available."}
                  className="text-sm leading-relaxed text-muted-foreground"
                />
              </div>
            </Section>

            {/* MOBILE, legacy card set (sold / lease / commercial): diligence flags
                keep their own card here; panel-eligible mobile carries them in the
                Verdict tab, and desktop's instance sits in the left column above. */}
            {!panelEligible && (
              <div className="lg:hidden">
                <ThingsToKnowCard flags={diligenceFlags} geoChecked={view.geoChecked} address={address} listingId={id} />
              </div>
            )}

            {/* Property Data Sheet — full TRREB payload, registry-driven. */}
            <div id="details" className="scroll-mt-28">
              <PropertyDataSheet groups={datasheet} />
            </div>

            {/* Zoning — municipal open data (NOT MLS), its own attributed card. */}
            <ZoningCard code={p.zoning_designation} desc={p.zoning_desc} sourceKey={p.zoning_source} />

            {/* Room Dimensions — proportional, drawn-to-scale room map */}
            {rooms.length > 0 && (
              <div id="rooms" className="scroll-mt-28">
                <RoomMap rooms={rooms} className="mb-6" />
              </div>
            )}

            {/* Schools — "Schools near this home" is a dwelling lens; off for commercial. */}
            {!isCommercial && <NearbySchools listingId={id} />}

            {/* Grocery + recreation proximity */}
            <NearbyAmenities listingId={id} />

            {/* Your Take — private note + personal deal-breaker auto-screen (client, localStorage). */}
            {!isCommercial && (
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
            )}
          </div>
        </div>

        {/* ── FULL-WIDTH: THE MARKET zone (label mobile-only) — rents + history + comps. ── */}
        <section id="market" className="scroll-mt-28 lg:mt-6">
          <div className="lg:hidden"><ZoneLabel>The Market</ZoneLabel></div>

          {/* Sell + rent grids LEAD the market zone (owner call 2026-07-24: prominent
              placement) — actual close medians (+ middle-50% ranges on sale prices)
              for consumers, asking for anon. Sale listings show prices first, rentals
              rents first. Streamed; self-hides on thin samples or missing coords. */}
          {!isCommercial && (
            <Suspense fallback={null}>
              <TypicalRents listingId={id} salesFirst={!isLease} />
            </Suspense>
          )}

        <section id="history" className="scroll-mt-28">
          {/* Mobile: default-OPEN, still collapsible behind a tap (defaultChecked).
              Pure CSS (a peer checkbox), so it stays server-rendered — no client
              boundary, no hydration flash. Desktop (md+) always shows it and hides
              the toggle. */}
          <input type="checkbox" id="history-toggle" defaultChecked className="peer sr-only" tabIndex={-1} aria-hidden="true" />
          <label
            htmlFor="history-toggle"
            className="flex min-h-[44px] cursor-pointer select-none items-center justify-between gap-2 border-t border-border py-3 peer-checked:[&_svg]:rotate-180 md:hidden"
          >
            <span className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-foreground">
              Property History
            </span>
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform" />
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
              locked={!isAuthed}
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

        {/* ── Comparable Properties (For Sale + Recently Sold), lazy client island.
             Commercial subjects use exact-subtype + area/price matching; commercial
             leases comp against For-Lease inventory (commercial-gap Phase 1). ── */}
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
          area={areaSqftOrNull ?? 0}
          isCommercial={isCommercial}
          // All lease subjects (residential rentals included) comp against For-Lease
          // actives + DealType=leased closings — sale comps under a rental compare a
          // monthly rent against purchase prices.
          isLease={isLease}
          // Buyer-facing "browse more homes" CTAs land on the list-first city hub
          // (SimilarProperties ignores it for lease/commercial, which the hub doesn't cover).
          cityHubHref={cityHref}
        />
        </div>
        </section>

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

/**
 * Hero label for BuildingAreaTotal. The feed quotes commercial/land area in
 * "Square Feet", "Acres" or "Square Metres" (BuildingAreaUnits); default Sqft
 * only when the unit field is absent.
 */
function buildingAreaUnitLabel(units?: string): string {
  const u = (units ?? "").toLowerCase();
  if (u.includes("acre")) return "Acres";
  if (u.includes("metre") || u.includes("meter")) return "Sqm";
  return "Sqft";
}

function SpecCell({ icon, value, label }: { icon: React.ReactNode; value: React.ReactNode; label: string }) {
  return (
    <div className="rounded-lg border border-border bg-card/50 p-3 text-center">
      <div className="mx-auto mb-1 flex justify-center">{icon}</div>
      <span className="block font-mono text-lg font-bold text-foreground">{value}</span>
      <span className="block text-[10px] uppercase text-muted-foreground">{label}</span>
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
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-foreground">
        {icon}
        {title}
      </h3>
      {children}
    </div>
  );
}

/** PROTOTYPE (Proposal B): zone marker — mono eyebrow + hairline, echoing the terminal voice. */
function ZoneLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-4 mt-2 flex items-center gap-3">
      <span className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-400">
        {children}
      </span>
      <span className="h-px flex-1 bg-border" aria-hidden />
    </div>
  );
}

/** PROTOTYPE (Proposal B): one compressed verdict row (The Read → scoreboard form). */
function VerdictRow({
  label,
  tone,
  text,
}: {
  label: string;
  tone: "emerald" | "amber" | "cyan";
  text: string;
}) {
  const toneClass =
    tone === "emerald"
      ? "text-emerald-700 dark:text-emerald-400"
      : tone === "amber"
        ? "text-amber-700 dark:text-amber-400"
        : "text-cyan-700 dark:text-cyan-400";
  return (
    <div className="grid grid-cols-[84px_1fr] gap-2 py-2">
      <span className={cn("pt-0.5 font-mono text-[11px] font-bold tracking-wider", toneClass)}>{label}</span>
      <span className="text-sm leading-snug text-foreground">{text}</span>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  valueClass = "text-muted-foreground",
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-mono", valueClass)}>{value}</span>
    </div>
  );
}
