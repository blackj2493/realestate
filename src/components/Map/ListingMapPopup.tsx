/**
 * ListingMapPopup — a pinned, interactive popup anchored at a clicked map point.
 *
 * Shows one card per listing at that point (single pin → 1 card; a cluster of
 * truly-stacked listings → the full set). Capped to ~3 cards tall, the rest
 * scroll. Each card reuses ListingCardBody so it is visually identical to the
 * right-hand ledger list; clicking a card opens that property's detail.
 *
 * Rendered as a sibling overlay inside AlphaMap's `relative` container, so x/y
 * (deck.gl pixel coords) position it directly; it is clamped to stay on-screen.
 */

"use client";

import { X, Crosshair } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ListingDocument } from "@/lib/typesense/client";
import { dealScoreFromDocument } from "@/lib/dealScore/fromListingDocument";
import { DealScoreGradePill } from "@/components/Property/DealScoreCard";
import { ListingThumbnail } from "@/components/listing/ListingThumbnail";
import ListingCardBody from "@/components/CommandCenter/ListingCardBody";
import WatchHeart from "@/components/watchlist/WatchHeart";

const POPUP_W = 340;
const CARD_EST_H = 300; // full-photo card (hero + details + comps) governs the on-screen clamp
const POPUP_MAX_H = 440; // tall enough to show one full hero card; multiple cards scroll

function PopupCard({
  listing,
  onSelect,
  onComps,
}: {
  listing: ListingDocument;
  onSelect: (l: ListingDocument) => void;
  onComps?: (l: ListingDocument) => void;
}) {
  const src = listing.thumbnailUrl || listing.primaryImageUrl;
  const deal = dealScoreFromDocument(listing);
  const loc = listing.location;
  const canComp = Boolean(onComps && Array.isArray(loc) && (loc[0] || loc[1]));
  return (
    <div className="border-b border-slate-800/60 last:border-b-0">
      {/* Clickable body is a DIV (not a button) so the Save heart — itself a button —
          can overlay the photo without nesting a <button> inside a <button>. */}
      <div
        onClick={() => onSelect(listing)}
        className="block w-full cursor-pointer text-left transition-colors hover:bg-slate-800/50"
      >
        {/* Full-width hero photo (HouseSigma-style) — the listing's main visual, not a
            cramped thumbnail. Deal pill + Save heart overlay the corners. */}
        <div className="relative h-44 w-full overflow-hidden bg-slate-800">
          <ListingThumbnail src={src} alt={listing.UnparsedAddress || "Property"} className="absolute inset-0" sizes="340px" />
          {deal.score !== null && (
            <DealScoreGradePill score={deal.score} grade={deal.grade} className="absolute left-2 top-2 z-10 backdrop-blur-sm" />
          )}
          <WatchHeart
            item={{ listing_key: listing.id, address: listing.UnparsedAddress, city: listing.City, thumb: src, list_price: listing.ListPrice, status: listing.Status }}
            className="absolute right-2 top-2 z-10 rounded-md bg-slate-900/70 p-1.5 transition-colors hover:bg-slate-900"
            iconClassName="h-4 w-4 text-slate-200"
          />
        </div>
        <div className="px-3 py-2.5">
          <ListingCardBody doc={listing} />
        </div>
      </div>
      {canComp && (
        <div className="px-3 pb-2.5">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onComps!(listing);
            }}
            title="Show recent comparable sales near this home"
            className="flex items-center gap-1.5 border border-cyan-500/40 bg-cyan-500/10 px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-cyan-300 transition-colors hover:bg-cyan-500/20"
          >
            <Crosshair className="h-3 w-3" />
            Comparable sales
          </button>
        </div>
      )}
    </div>
  );
}

export default function ListingMapPopup({
  listings,
  x,
  y,
  dims,
  onClose,
  onSelect,
  onComps,
}: {
  listings: ListingDocument[];
  x: number;
  y: number;
  dims: { width: number; height: number } | null;
  onClose: () => void;
  onSelect: (l: ListingDocument) => void;
  /** Enter comps-on-demand anchored to a card's home (sold-only, type + price band). */
  onComps?: (l: ListingDocument) => void;
}) {
  if (!listings.length) return null;

  const containerW = dims?.width ?? 800;
  const containerH = dims?.height ?? 600;

  const left = Math.max(8, Math.min(x - POPUP_W / 2, containerW - POPUP_W - 8));
  const estH = Math.min(POPUP_MAX_H, 34 + listings.length * CARD_EST_H);
  let top = y + 14;
  if (top + estH > containerH - 8) top = Math.max(8, containerH - estH - 8);

  return (
    <div
      className="pointer-events-auto absolute z-30 flex flex-col overflow-hidden rounded-md border border-slate-700 bg-slate-900 shadow-2xl shadow-black/60"
      style={{ left, top, width: POPUP_W, maxHeight: POPUP_MAX_H }}
    >
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-slate-800 px-3 py-1.5">
        <span className="font-mono text-[11px] uppercase tracking-wider text-slate-400">
          {listings.length} Listing{listings.length === 1 ? "" : "s"} here
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-sm p-0.5 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-200"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Cards — max ~3 visible, rest scroll */}
      <div className={cn("min-h-0 flex-1 overflow-y-auto")}>
        {listings.map((l) => (
          <PopupCard key={l.id} listing={l} onSelect={onSelect} onComps={onComps} />
        ))}
      </div>
    </div>
  );
}
