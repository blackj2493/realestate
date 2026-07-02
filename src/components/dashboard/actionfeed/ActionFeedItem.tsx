"use client";

import Link from "next/link";
import { formatPrice } from "@/lib/utils";
import { ListingThumbnail } from "@/components/listing/ListingThumbnail";
import type { FeedItem } from "./useActionFeed";

/**
 * One action-feed row: thumbnail · headline + address + brokerage · status chip +
 * price. Deep-links to the listing. Brokerage is rendered in the same size/weight
 * as the other listing details (TRREB IDX/VOW mandatory-display rule).
 */
export default function ActionFeedItem({ item }: { item: FeedItem }) {
  return (
    <Link
      href={`/properties/${item.listingKey}`}
      className="flex items-center gap-3 border-b border-border/60 px-3 py-2 transition-colors last:border-b-0 hover:bg-muted/50"
    >
      <ListingThumbnail
        src={item.thumb}
        alt={item.address}
        className="h-14 w-20 shrink-0"
        sizes="80px"
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={`terminal-font shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${item.chipCls}`}
          >
            {item.chipText}
          </span>
          <span className="truncate text-xs text-foreground">{item.headline}</span>
        </div>
        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{item.address}</p>
        <p className="truncate text-[10px] text-muted-foreground">
          {item.city ? <span className="uppercase tracking-wide">{item.city}</span> : null}
          {item.city && item.brokerage ? " · " : null}
          {item.brokerage}
        </p>
      </div>

      <div className="terminal-font shrink-0 text-right text-sm font-semibold text-cyan-400">
        {item.price ? formatPrice(item.price) : "—"}
      </div>
    </Link>
  );
}
