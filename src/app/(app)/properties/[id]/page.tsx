/**
 * /properties/[id] — server-rendered, SEO-optimized listing detail page.
 *
 * Ported from the Command Center's ListingTerminal 70/30 layout, but fed by the
 * full Supabase payload (real rooms, all photos, AVM estimate, condo-fee stability)
 * and emitting per-listing <title>/meta/OpenGraph + JSON-LD for crawlers.
 *
 * Compliance: serves the `listings` table (active IDX) only; brokerage is displayed;
 * all derived metrics are deterministic (no LLM transformation).
 */

import type { Metadata } from "next";
import Link from "next/link";
import { Bed, Bath, Square, Car, Home, AlertTriangle, Building2 } from "lucide-react";
import { cn, formatPrice } from "@/lib/utils";
import { getListingDetail, gateSaleHistory } from "@/lib/property/getListingDetail";
import { getCurrentUser } from "@/lib/supabase/server";
import { AlphaBadge, detectPropertyBadges } from "@/components/CommandCenter/AlphaBadge";
import UnderwritingSandbox from "@/components/Property/UnderwritingSandbox";
import RoomMap from "@/components/Property/RoomMap";
import DOMTimelineChart, { type SaleMarker } from "@/components/CommandCenter/DOMTimelineChart";
import ListingEstimateCard from "@/components/Property/ListingEstimateCard";
import ForceAppreciationCard from "@/components/Property/ForceAppreciationCard";
import CondoFeeStabilityCard from "@/components/Property/CondoFeeStabilityCard";
import SaleHistorySection from "@/components/Property/SaleHistorySection";
import DealScoreCard, { DealScoreBadge } from "@/components/Property/DealScoreCard";
import SocialProofBar from "@/components/Property/SocialProofBar";
import PropertyGallery from "./PropertyGallery";
import RecordView from "./RecordView";
import ListingActions from "./ListingActions";
import NearbySchools from "./NearbySchools";
import PropertyNotFound from "./PropertyNotFound";

export const dynamic = "force-dynamic";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://pureproperty.ca").replace(/\/$/, "");

interface RawListing {
  ListingKey?: string;
  ListPrice?: number;
  OriginalListPrice?: number;
  UnparsedAddress?: string;
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
}

function calculateDaysOnMarket(ts?: string): number {
  if (!ts) return 0;
  const diff = Date.now() - new Date(ts).getTime();
  return Math.max(0, Math.ceil(diff / 86_400_000) - 1);
}

function asArray(v: string[] | string | undefined): string[] {
  if (Array.isArray(v)) return v.filter(Boolean);
  return v ? [v] : [];
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
  const detail = await getListingDetail(id).catch(() => null);

  if (!detail) {
    return {
      title: "Property Syncing | PureProperty",
      robots: { index: false, follow: true },
    };
  }

  const p = detail.full_payload as RawListing;
  const address = p.UnparsedAddress || detail.city || "Listing";
  const price = p.ListPrice || 0;
  const canonical = `${SITE_URL}/properties/${id}`;
  const title = `${address} — ${formatPrice(price)} | PureProperty`;
  const description =
    cleanDescription(p.PublicRemarks) ||
    `${address}. ${p.BedroomsTotal ?? 0} bed, ${p.BathroomsTotalInteger ?? 0} bath ${
      p.PropertySubType || "home"
    } listed at ${formatPrice(price)}.`;
  const isActive = (p.StandardStatus ?? "Active") === "Active";
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

function buildJsonLd(id: string, detail: Awaited<ReturnType<typeof getListingDetail>>) {
  if (!detail) return null;
  const p = detail.full_payload as RawListing;
  const subType = (p.PropertySubType || "").toLowerCase();
  const schemaType = /condo|apartment/.test(subType) ? "Apartment" : "SingleFamilyResidence";

  return {
    "@context": "https://schema.org",
    "@type": schemaType,
    name: p.UnparsedAddress || "Property listing",
    description: cleanDescription(p.PublicRemarks, 500) || undefined,
    url: `${SITE_URL}/properties/${id}`,
    image: detail.media_urls.slice(0, 8),
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
    ...(p.OriginalEntryTimestamp ? { datePosted: p.OriginalEntryTimestamp } : {}),
    offers: {
      "@type": "Offer",
      price: p.ListPrice || 0,
      priceCurrency: "CAD",
      availability: "https://schema.org/InStock",
      url: `${SITE_URL}/properties/${id}`,
      ...(p.ListOfficeName
        ? { seller: { "@type": "RealEstateAgent", name: p.ListOfficeName } }
        : {}),
    },
  };
}

export default async function PropertyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getListingDetail(id).catch(() => null);

  if (!detail) {
    return (
      <main className="min-h-screen bg-slate-950">
        <PropertyNotFound id={id} />
      </main>
    );
  }

  // VOW gating: strip sold prices/dates for anonymous users (§4).
  const isAuthed = !!(await getCurrentUser());
  const saleHistory = gateSaleHistory(detail.saleHistory, isAuthed);
  // Prior sold prices for the price-history chart — authed only (events are empty otherwise).
  const saleMarkers: SaleMarker[] = saleHistory.events
    .filter((e) => e.close_price && e.close_price > 0 && (e.contract_date || e.close_date))
    .map((e) => ({ date: (e.contract_date || e.close_date) as string, price: e.close_price as number }));

  const p = detail.full_payload as RawListing;
  const address = p.UnparsedAddress || detail.city || "Address Unavailable";
  const price = p.ListPrice || 0;
  const dom = p.DaysOnMarket ?? calculateDaysOnMarket(p.OriginalEntryTimestamp);
  // True DOM (stitched across relists) from the Temporal Distress Engine; falls back to raw DOM.
  const trueDom = detail.priceTimeline.trueDom ?? dom;
  const rooms = detail.rooms;
  const hasSuitePotential = (p.KitchensBelowGrade ?? 0) > 0;
  const jsonLd = buildJsonLd(id, detail);

  const badges = detectPropertyBadges({
    hasSecondarySuitePotential: hasSuitePotential,
    KitchensBelowGrade: p.KitchensBelowGrade,
    PublicRemarks: p.PublicRemarks,
    ListPrice: p.ListPrice,
    OriginalListPrice: p.OriginalListPrice,
    DaysOnMarket: dom,
  });

  const style = asArray(p.ArchitecturalStyle).join(", ");
  const basement = asArray(p.Basement).join(", ");
  const cooling = asArray(p.Cooling).join(", ");

  const vitals: Array<{ label: string; value: string }> = [
    {
      label: "Lot Dimensions",
      value: p.LotWidth ? `${p.LotWidth} x ${p.LotDepth ?? "N/A"} ${p.LotSizeUnits ?? ""}`.trim() : "N/A",
    },
    { label: "Property Age", value: p.ApproximateAge || "N/A" },
    { label: "Heating", value: [p.HeatType, p.HeatSource].filter(Boolean).join(" · ") || "N/A" },
    { label: "Cooling", value: cooling || "N/A" },
    { label: "Direction Faces", value: p.DirectionFaces || "N/A" },
    { label: "Basement", value: basement || "N/A" },
  ];

  const summary: Array<{ label: string; value: string }> = [
    { label: "Property Type", value: p.PropertySubType || p.PropertyType || "N/A" },
    { label: "Style", value: style || "N/A" },
    { label: "Annual Taxes", value: p.TaxAnnualAmount ? formatPrice(p.TaxAnnualAmount) : "N/A" },
    {
      label: "Kitchens",
      value: `${p.KitchensTotal ?? 0} (${p.KitchensAboveGrade ?? 0} above · ${p.KitchensBelowGrade ?? 0} below)`,
    },
    {
      label: "Rooms",
      value: `${p.RoomsAboveGrade ?? 0} above · ${p.RoomsBelowGrade ?? 0} below`,
    },
    {
      label: "Bedrooms",
      value: `${p.BedroomsAboveGrade ?? p.BedroomsTotal ?? 0} above · ${p.BedroomsBelowGrade ?? 0} below`,
    },
  ];

  return (
    <main className="min-h-screen bg-slate-950 text-slate-200">
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
      />

      <div className="mx-auto max-w-[1400px] px-4 py-6">
        <Link
          href="/properties"
          className="mb-4 inline-block text-sm text-cyan-400 transition-colors hover:text-cyan-300"
        >
          ← Back to Command Center
        </Link>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[7fr_3fr]">
          {/* ── LEFT (70%) ── */}
          <div>
            {/* Header */}
            <div className="mb-6">
              {badges.length > 0 && (
                <div className="mb-3 flex flex-wrap gap-2">
                  {badges.map((b, i) => (
                    <AlphaBadge key={i} variant={b.variant} label={b.label} value={b.value} />
                  ))}
                </div>
              )}
              <h1 className="mb-2 text-2xl font-bold text-slate-100">{address}</h1>
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <span className="font-mono text-3xl font-bold text-emerald-400">
                  {formatPrice(price)}
                </span>
                <span className="text-sm text-slate-500">
                  {p.City}
                  {p.PropertySubType ? `, ${p.PropertySubType}` : ""}
                </span>
                <span className="text-sm font-semibold text-slate-400">
                  Listed {dom} {dom === 1 ? "day" : "days"} ago
                </span>
                <DealScoreBadge score={detail.dealScore.score} grade={detail.dealScore.grade} />
              </div>
              {p.ListOfficeName && (
                <p className="mt-2 flex items-center gap-1.5 text-sm text-slate-400">
                  <Building2 className="h-4 w-4 text-slate-500" />
                  Listed by {p.ListOfficeName}
                </p>
              )}
            </div>

            {/* Social proof — honest, deterministic activity counters */}
            <SocialProofBar listingId={id} className="mb-6" />

            {/* Gallery */}
            <div className="mb-6">
              <PropertyGallery images={detail.media_urls} />
            </div>

            {/* Specs */}
            <div className="mb-6 grid grid-cols-4 gap-3">
              <SpecCell icon={<Bed className="h-5 w-5 text-emerald-400" />} value={p.BedroomsTotal ?? 0} label="Beds" />
              <SpecCell icon={<Bath className="h-5 w-5 text-cyan-400" />} value={p.BathroomsTotalInteger ?? 0} label="Baths" />
              <SpecCell
                icon={<Square className="h-5 w-5 text-purple-400" />}
                value={p.BuildingAreaTotal ? p.BuildingAreaTotal.toLocaleString() : "N/A"}
                label="Sqft"
              />
              <SpecCell icon={<Car className="h-5 w-5 text-amber-400" />} value={p.ParkingTotal ?? p.CoveredSpaces ?? 0} label="Parking" />
            </div>

            {/* Structural Vitals */}
            <Section title="Structural Vitals" icon={<Home className="h-4 w-4 text-emerald-400" />}>
              <table className="w-full border-collapse text-sm">
                <tbody className="divide-y divide-slate-800">
                  {vitals.map((row) => (
                    <tr key={row.label}>
                      <td className="w-1/3 py-2 text-slate-500">{row.label}</td>
                      <td className="py-2 font-mono text-slate-200">{row.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>

            {/* Property Summary (richer than the modal) */}
            <Section title="Property Summary" icon={<Building2 className="h-4 w-4 text-emerald-400" />}>
              <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                {summary.map((row) => (
                  <div key={row.label}>
                    <p className="text-xs text-slate-500">{row.label}</p>
                    <p className="font-medium text-slate-200">{row.value}</p>
                  </div>
                ))}
              </div>
            </Section>

            {/* Schools */}
            <NearbySchools listingId={id} />

            {/* Room Dimensions — proportional, drawn-to-scale room map */}
            {rooms.length > 0 && <RoomMap rooms={rooms} className="mb-6" />}

            {/* Remarks */}
            <Section title="Unvarnished Remarks" icon={<AlertTriangle className="h-4 w-4 text-amber-400" />}>
              <div className="rounded-lg border border-slate-800 bg-slate-900/30 p-4">
                <p className="whitespace-pre-line text-sm leading-relaxed text-slate-300">
                  {p.PublicRemarks || "No remarks available."}
                </p>
              </div>
            </Section>

            {/* Brokerage (mandatory display) */}
            <Section title="Listed By" icon={<Building2 className="h-4 w-4 text-emerald-400" />}>
              <p className="text-sm text-slate-300">
                {p.ListOfficeName || "Brokerage information not available"}
              </p>
            </Section>
          </div>

          {/* ── RIGHT (30%, sticky) ── */}
          <div>
            <div className="sticky top-6 space-y-4">
              {/* Deal Score — flagship signal, pinned to the top of the rail */}
              <DealScoreCard dealScore={detail.dealScore} />

              {/* PureProperty Estimate — our AVM, directly under the Deal Score */}
              <ListingEstimateCard estimate={detail.estimate} listPrice={price} cityRegion={p.CityRegion} city={p.City} />

              {/* Force-Appreciation — renovation ROI from the Value-Add Engine */}
              <ForceAppreciationCard report={detail.valueAdd} />

              {/* Asset Summary */}
              <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-200">
                  Asset Summary
                </h3>
                <div className="space-y-2 text-xs">
                  <SummaryRow label="List Price" value={formatPrice(price)} valueClass="text-emerald-400" />
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

              <UnderwritingSandbox
                listingId={id}
                listPrice={price}
                annualTaxes={p.TaxAnnualAmount || 0}
                monthlyFees={p.AssociationFee || 0}
                hasSuitePotential={hasSuitePotential}
              />

              <DOMTimelineChart
                currentPrice={price}
                originalPrice={detail.priceTimeline.originalPrice ?? undefined}
                priceDrop={detail.priceTimeline.totalPriceDrop}
                dom={trueDom}
                saleMarkers={saleMarkers}
              />

              <CondoFeeStabilityCard feeStability={detail.feeStability} />

              <SaleHistorySection saleHistory={saleHistory} isAuthed={isAuthed} />

              <ListingActions
                id={id}
                address={address}
                city={detail.city ?? undefined}
                price={price}
                thumb={detail.media_urls[0]}
              />
            </div>
          </div>
        </div>
      </div>
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
