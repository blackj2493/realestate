"use client";

import Link from "next/link";
import { formatPrice } from "@/lib/utils";
import type { ListingDocument } from "@/lib/typesense/client";
import type { BoardDef } from "@/lib/dashboard/boards";
import WatchButton from "@/components/watchlist/WatchButton";
import { ListingThumbnail } from "@/components/listing/ListingThumbnail";

export default function PlaylistRow({
  listing,
  board,
}: {
  listing: ListingDocument;
  board: BoardDef;
}) {
  const raw = listing.thumbnailUrl || listing.primaryImageUrl;
  const metric = board.formatMetric(listing[board.metricField] as number | undefined);
  const addr = listing.UnparsedAddress?.trim() || listing.City || "Address unavailable";

  return (
    <Link
      href={`/properties/${listing.id}`}
      className="group flex items-center gap-3 border-b border-slate-800/50 px-3 py-2 transition-colors last:border-b-0 hover:bg-slate-800/50"
    >
      <ListingThumbnail
        src={raw}
        alt={addr}
        className="h-10 w-14 shrink-0"
        sizes="56px"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate font-sans text-xs font-medium text-slate-200">{addr}</p>
        {/* Brokerage rendered at text-xs text-slate-400 — same size as sibling listing
            details, per TRREB §6.3(c) (no visual de-emphasis vs other listing info). */}
        <p className="truncate text-xs uppercase tracking-wide text-slate-400">
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
