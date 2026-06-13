// src/components/Property/SoldCompCard.tsx
"use client";

import Link from "next/link";
import { Bed, Bath, Lock } from "lucide-react";
import { formatPrice } from "@/lib/utils";
import { ListingThumbnail } from "@/components/listing/ListingThumbnail";
import { DeltaChips } from "@/components/Property/DeltaChips";
import type { SimilarSoldCard } from "@/app/api/properties/[id]/similar/route";

function fmtSoldDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });
}

/** A single recently-sold comp. `locked` (anonymous) blurs the VOW numbers. */
export function SoldCompCard({ card, locked }: { card: SimilarSoldCard; locked?: boolean }) {
  if (locked) {
    return (
      <Link
        href="/login"
        className="block w-[260px] shrink-0 overflow-hidden rounded-lg border border-slate-800 bg-slate-900/50"
      >
        <div className="relative aspect-[4/3] bg-slate-800/60">
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-slate-400">
            <Lock className="h-5 w-5" />
            <span className="text-xs">Sign in for sold price</span>
          </div>
        </div>
        <div className="space-y-1 p-3">
          <div className="h-5 w-24 rounded bg-slate-800" />
          <div className="h-3 w-32 rounded bg-slate-800/70" />
        </div>
      </Link>
    );
  }

  return (
    <Link
      href={`/properties/${card.id}`}
      className="group block w-[260px] shrink-0 overflow-hidden rounded-lg border border-slate-800 bg-slate-900/50 transition-colors hover:border-slate-700"
    >
      <div className="relative aspect-[4/3]">
        <ListingThumbnail
          src={card.thumb}
          alt={card.address}
          className="absolute inset-0"
          imgClassName="group-hover:scale-105 transition-transform duration-300"
          sizes="260px"
        />
        <span className="absolute left-2 top-2 rounded bg-rose-500/90 px-2 py-0.5 font-mono text-[10px] font-bold tracking-wider text-white">
          SOLD{card.soldDate ? ` ${fmtSoldDate(card.soldDate)}` : ""}
        </span>
      </div>
      <div className="p-3">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-lg font-bold text-emerald-400">
            {formatPrice(card.closePrice)}
          </span>
          {card.pctOfAsk != null && (
            <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-300">
              {card.pctOfAsk.toFixed(0)}% of ask
            </span>
          )}
        </div>
        <p className="mt-1 line-clamp-1 text-sm font-medium text-slate-200">{card.address}</p>
        <div className="mt-1 flex items-center gap-3 text-xs text-slate-400">
          {card.beds != null && card.beds > 0 && (
            <span className="flex items-center gap-1">
              <Bed className="h-3 w-3" />
              {card.beds}
            </span>
          )}
          {card.baths != null && card.baths > 0 && (
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
