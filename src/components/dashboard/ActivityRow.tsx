"use client";

import Link from "next/link";
import { formatPrice } from "@/lib/utils";
import WatchButton from "@/components/watchlist/WatchButton";
import { ListingThumbnail } from "@/components/listing/ListingThumbnail";

/**
 * Property-card row for the Market Activity lists (New or Sold): thumbnail + key
 * specs + price. Brokerage is rendered at text-xs text-muted-foreground — same size as
 * other listing details and not visually separated, per TRREB §6.3(c). Deep-links
 * to the detail page.
 */
export default function ActivityRow({
  id,
  address,
  city,
  brokerage,
  price,
  priceLabel,
  caption,
  image,
  propertySubType,
  beds,
  baths,
  sqft,
  watchable = false,
}: {
  id: string;
  address: string;
  city?: string | null;
  brokerage?: string | null;
  price: number;
  priceLabel?: string;
  caption?: string;
  image?: string | null;
  propertySubType?: string | null;
  beds?: number | null;
  baths?: number | null;
  sqft?: number | null;
  watchable?: boolean;
}) {
  const addr = address?.trim() || city || "Address unavailable";

  const specs: string[] = [];
  if (propertySubType) specs.push(propertySubType.trim());
  if (beds != null && beds > 0) specs.push(`${beds} bd`);
  if (baths != null && baths > 0) specs.push(`${baths} ba`);
  if (sqft != null && sqft > 0) specs.push(`${Math.round(sqft).toLocaleString()} sf`);

  return (
    <Link
      href={`/properties/${id}`}
      className="group flex gap-3 border-b border-border/50 p-2 transition-colors last:border-b-0 hover:bg-muted/50"
    >
      <ListingThumbnail
        src={image}
        alt={addr}
        className="h-14 w-20 shrink-0"
        sizes="80px"
      />
      <div className="flex min-w-0 flex-1 flex-col justify-between py-0.5">
        <div className="min-w-0">
          <p className="truncate font-sans text-xs font-medium text-foreground">{addr}</p>
          {specs.length > 0 && (
            <p className="terminal-font mt-0.5 truncate text-[10px] uppercase tracking-wide text-muted-foreground">
              {specs.join(" · ")}
            </p>
          )}
        </div>
        {/* Brokerage rendered at text-xs text-muted-foreground — same size as sibling listing
            details, per TRREB §6.3(c) (no visual de-emphasis vs other listing info). */}
        <p className="truncate text-xs text-muted-foreground">
          {city || "—"}
          {brokerage ? <span> · {brokerage}</span> : null}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end justify-between py-0.5 text-right">
        <div className="terminal-font text-sm font-bold text-cyan-700 dark:text-cyan-400">
          {priceLabel ? (
            <span className="mr-1 text-[9px] uppercase tracking-wider text-muted-foreground">
              {priceLabel}
            </span>
          ) : null}
          {formatPrice(price)}
        </div>
        {caption ? (
          <div className="terminal-font text-[10px] text-muted-foreground">{caption}</div>
        ) : null}
        {watchable ? (
          <WatchButton
            item={{
              listing_key: id,
              address: addr,
              city: city ?? undefined,
              thumb: image ?? undefined,
              list_price: price,
            }}
            size={15}
          />
        ) : null}
      </div>
    </Link>
  );
}
