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

import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ListingDocument } from "@/lib/typesense/client";
import { dealScoreFromDocument } from "@/lib/dealScore/fromListingDocument";
import { DealScoreGradePill } from "@/components/Property/DealScoreCard";
import { ListingThumbnail } from "@/components/listing/ListingThumbnail";
import ListingCardBody from "@/components/CommandCenter/ListingCardBody";

const POPUP_W = 340;
const CARD_EST_H = 96; // header + ~3 cards governs the on-screen clamp

function PopupCard({ listing, onSelect }: { listing: ListingDocument; onSelect: (l: ListingDocument) => void }) {
  const src = listing.thumbnailUrl || listing.primaryImageUrl;
  const deal = dealScoreFromDocument(listing);
  return (
    <button
      type="button"
      onClick={() => onSelect(listing)}
      className="flex w-full items-stretch gap-3 border-b border-slate-800/60 px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-slate-800/50"
    >
      <div className="relative h-20 w-24 shrink-0 overflow-hidden rounded-sm">
        <ListingThumbnail src={src} alt={listing.UnparsedAddress || "Property"} className="absolute inset-0" sizes="96px" />
        {deal.score !== null && (
          <DealScoreGradePill score={deal.score} grade={deal.grade} className="absolute left-1 top-1 z-10 backdrop-blur-sm" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <ListingCardBody doc={listing} />
      </div>
    </button>
  );
}

export default function ListingMapPopup({
  listings,
  x,
  y,
  dims,
  onClose,
  onSelect,
}: {
  listings: ListingDocument[];
  x: number;
  y: number;
  dims: { width: number; height: number } | null;
  onClose: () => void;
  onSelect: (l: ListingDocument) => void;
}) {
  if (!listings.length) return null;

  const containerW = dims?.width ?? 800;
  const containerH = dims?.height ?? 600;

  const left = Math.max(8, Math.min(x - POPUP_W / 2, containerW - POPUP_W - 8));
  const estH = 34 + Math.min(listings.length, 3) * CARD_EST_H;
  let top = y + 14;
  if (top + estH > containerH - 8) top = Math.max(8, containerH - estH - 8);

  return (
    <div
      className="pointer-events-auto absolute z-30 flex max-h-[330px] flex-col rounded-md border border-slate-700 bg-slate-900/97 shadow-2xl shadow-black/50 backdrop-blur-sm"
      style={{ left, top, width: POPUP_W }}
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
          <PopupCard key={l.id} listing={l} onSelect={onSelect} />
        ))}
      </div>
    </div>
  );
}
