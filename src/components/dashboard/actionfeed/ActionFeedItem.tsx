"use client";

import Link from "next/link";
import { formatPrice } from "@/lib/utils";
import { ListingThumbnail } from "@/components/listing/ListingThumbnail";
import { StatusLight, type StatusTone } from "@/components/daylight/primitives";
import type { FeedItem, FeedKind } from "./useActionFeed";

/** Feed event → status-light tone. Dark renders match the current chip palette;
 *  light differentiates relisted=blue / new=green per the Daylight mockup. */
const KIND_TONE: Record<FeedKind, StatusTone> = {
  WATCH_SOLD: "sold",
  WATCH_LEASED: "leased",
  WATCH_RELISTED: "relisted",
  WATCH_OFF_MARKET: "off",
  WATCH_PRICE_DROP: "drop",
  WATCH_STALE: "stale",
  NEW_LISTING: "new",
};

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
          <StatusLight tone={KIND_TONE[item.kind]} className="shrink-0">
            {item.chipText}
          </StatusLight>
          <span className="truncate text-xs text-foreground">{item.headline}</span>
        </div>
        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{item.address}</p>
        {/* TRREB §6.3(c): brokerage on every listing; placeholder when the feed omitted it. */}
        <p className="truncate text-[10px] text-muted-foreground">
          {item.city ? <span className="uppercase tracking-wide">{item.city}</span> : null}
          {item.city ? " · " : null}
          {item.brokerage || "Brokerage unavailable"}
        </p>
      </div>

      <div className="terminal-font shrink-0 text-right text-sm font-semibold text-cyan-700 dark:text-cyan-400">
        {item.price ? formatPrice(item.price) : "—"}
      </div>
    </Link>
  );
}
