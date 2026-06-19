// src/components/Property/ForSaleCompCard.tsx
"use client";

import Link from "next/link";
import { Bed, Bath } from "lucide-react";
import { formatPrice } from "@/lib/utils";
import { bedsLabel } from "@/lib/listings/bedsLabel";
import { ListingThumbnail } from "@/components/listing/ListingThumbnail";
import { DeltaChips } from "@/components/Property/DeltaChips";
import type { SimilarForSaleCard } from "@/app/api/properties/[id]/similar/route";

/**
 * A single active (For Sale) comp. Deliberately mirrors {@link SoldCompCard}'s
 * layout so both comparable rows scan identically — the one intentional difference
 * is COLOUR: For Sale carries a CYAN accent (live listing), Sold carries
 * ROSE/EMERALD (closed). Badge → price → address → beds/baths → delta chips →
 * brokerage → "why" label, in the same order and sizes as the sold card.
 */
export function ForSaleCompCard({ card }: { card: SimilarForSaleCard }) {
  const dom = card.daysOnMarket;
  const isNew = dom != null && dom <= 7;
  // "4+2" when there are below-grade beds, else "4" — matches the subject detail page.
  const beds = bedsLabel({
    BedroomsAboveGrade: card.bedsAbove,
    BedroomsBelowGrade: card.bedsBelow,
    BedroomsTotal: card.beds,
  });

  return (
    <Link
      href={`/properties/${card.id}`}
      className="group block w-[260px] shrink-0 overflow-hidden rounded-lg border border-l-2 border-slate-800 border-l-cyan-500/40 bg-slate-900/50 transition-colors hover:border-slate-700 hover:border-l-cyan-400"
    >
      <div className="relative aspect-[4/3]">
        <ListingThumbnail
          src={card.thumb}
          alt={card.address}
          className="absolute inset-0"
          imgClassName="group-hover:scale-105 transition-transform duration-300"
          sizes="260px"
        />
        <span className="absolute left-2 top-2 rounded bg-cyan-500/90 px-2 py-0.5 font-mono text-[10px] font-bold tracking-wider text-white">
          {isNew ? "NEW" : "FOR SALE"}
        </span>
      </div>
      <div className="p-3">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-lg font-bold text-cyan-400">
            {formatPrice(card.price)}
          </span>
          {dom != null && (
            <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-300">
              {dom}d on market
            </span>
          )}
        </div>
        <p className="mt-1 line-clamp-1 text-sm font-medium text-slate-200">{card.address}</p>
        <div className="mt-1 flex items-center gap-3 text-xs text-slate-400">
          {beds && (
            <span className="flex items-center gap-1">
              <Bed className="h-3 w-3" />
              {beds}
            </span>
          )}
          {card.baths > 0 && (
            <span className="flex items-center gap-1">
              <Bath className="h-3 w-3" />
              {card.baths}
            </span>
          )}
        </div>
        <DeltaChips deltas={card.deltas} className="mt-2" />
        {/* Brokerage — same text size as the details above (TRREB §6.3(c)). */}
        <p className="mt-2 text-xs text-slate-500">Listed by {card.brokerage || "Unknown"}</p>
        <p className="mt-1 text-[11px] text-cyan-300/80">{card.why}</p>
      </div>
    </Link>
  );
}
