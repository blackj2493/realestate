"use client";

import Link from "next/link";
import { formatPrice } from "@/lib/utils";

/**
 * One compact row in the Market Activity lists (New or Sold). Brokerage is shown
 * at the same size as the other listing details and not visually separated, per
 * TRREB §6.3(c). Deep-links to the listing detail page.
 */
export default function ActivityRow({
  id,
  address,
  city,
  brokerage,
  price,
  priceLabel,
  caption,
}: {
  id: string;
  address: string;
  city?: string | null;
  brokerage?: string | null;
  price: number;
  /** small label above the price, e.g. "SOLD" or "LIST". */
  priceLabel?: string;
  /** small right-aligned caption, e.g. sold date or "3d ago". */
  caption?: string;
}) {
  const addr = address?.trim() || city || "Address unavailable";
  return (
    <Link
      href={`/properties/${id}`}
      className="group flex items-center gap-3 border-b border-slate-800/50 px-3 py-2 transition-colors last:border-b-0 hover:bg-slate-800/50"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate font-sans text-xs font-medium text-slate-200">{addr}</p>
        <p className="truncate text-[10px] uppercase tracking-wide text-slate-500">
          {city || "—"}
          {brokerage ? (
            <span className="normal-case tracking-normal"> · {brokerage}</span>
          ) : null}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <div className="terminal-font text-xs font-semibold text-cyan-400">
          {priceLabel ? (
            <span className="mr-1 text-[9px] uppercase tracking-wider text-slate-500">
              {priceLabel}
            </span>
          ) : null}
          {formatPrice(price)}
        </div>
        {caption ? (
          <div className="terminal-font text-[10px] text-slate-400">{caption}</div>
        ) : null}
      </div>
    </Link>
  );
}
