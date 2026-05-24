"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { formatPrice } from "@/lib/utils";
import type { ListingDocument } from "@/lib/typesense/client";
import type { BoardDef } from "@/lib/dashboard/boards";
import WatchButton from "@/components/watchlist/WatchButton";

const PLACEHOLDER =
  "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=200&h=150&fit=crop";
const usable = (u?: string) => !!u && !u.includes("example.com");

export default function PlaylistRow({
  listing,
  board,
}: {
  listing: ListingDocument;
  board: BoardDef;
}) {
  const [err, setErr] = useState(false);
  const raw = listing.thumbnailUrl || listing.primaryImageUrl;
  const src = !err && usable(raw) ? raw! : PLACEHOLDER;
  const metric = board.formatMetric(listing[board.metricField] as number | undefined);
  const addr = listing.UnparsedAddress?.trim() || listing.City || "Address unavailable";

  return (
    <Link
      href={`/properties/${listing.id}`}
      className="group flex items-center gap-3 border-b border-slate-800/50 px-3 py-2 transition-colors last:border-b-0 hover:bg-slate-800/50"
    >
      <div className="relative h-10 w-14 shrink-0 overflow-hidden bg-slate-800">
        <Image
          src={src}
          alt={addr}
          fill
          className="object-cover"
          unoptimized
          onError={() => setErr(true)}
        />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-sans text-xs font-medium text-slate-200">{addr}</p>
        {/* Brokerage shown at the same size as other listing details (TRREB §4). */}
        <p className="truncate text-[10px] uppercase tracking-wide text-slate-500">
          {listing.City || "—"}
          {listing.ListOfficeName ? (
            <span className="normal-case tracking-normal"> · {listing.ListOfficeName}</span>
          ) : null}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <div className="terminal-font text-xs font-semibold text-cyan-400">{metric}</div>
        <div className="terminal-font text-[10px] text-slate-400">
          {formatPrice(listing.ListPrice)}
        </div>
      </div>
      <WatchButton
        item={{
          listing_key: listing.id,
          address: addr,
          city: listing.City,
          thumb: raw,
          list_price: listing.ListPrice,
          status: listing.Status,
        }}
        className="shrink-0"
        size={15}
      />
    </Link>
  );
}
