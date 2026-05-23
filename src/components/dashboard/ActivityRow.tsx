"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { formatPrice } from "@/lib/utils";

const PLACEHOLDER =
  "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=200&h=150&fit=crop";
const usable = (u?: string | null) => !!u && !u.includes("example.com");

/**
 * Property-card row for the Market Activity lists (New or Sold): thumbnail + key
 * specs + price. Brokerage is shown at the same size as the other listing details
 * and not visually separated, per TRREB §6.3(c). Deep-links to the detail page.
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
}) {
  const [err, setErr] = useState(false);
  const src = !err && usable(image) ? image! : PLACEHOLDER;
  const addr = address?.trim() || city || "Address unavailable";

  const specs: string[] = [];
  if (propertySubType) specs.push(propertySubType.trim());
  if (beds != null && beds > 0) specs.push(`${beds} bd`);
  if (baths != null && baths > 0) specs.push(`${baths} ba`);
  if (sqft != null && sqft > 0) specs.push(`${Math.round(sqft).toLocaleString()} sf`);

  return (
    <Link
      href={`/properties/${id}`}
      className="group flex gap-3 border-b border-slate-800/50 p-2 transition-colors last:border-b-0 hover:bg-slate-800/50"
    >
      <div className="relative h-16 w-24 shrink-0 overflow-hidden bg-slate-800">
        <Image
          src={src}
          alt={addr}
          fill
          className="object-cover"
          unoptimized
          onError={() => setErr(true)}
          sizes="96px"
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-between py-0.5">
        <div className="min-w-0">
          <p className="truncate font-sans text-xs font-medium text-slate-200">{addr}</p>
          {specs.length > 0 && (
            <p className="terminal-font mt-0.5 truncate text-[10px] uppercase tracking-wide text-slate-400">
              {specs.join(" · ")}
            </p>
          )}
        </div>
        <p className="truncate text-[10px] text-slate-500">
          {city || "—"}
          {brokerage ? <span> · {brokerage}</span> : null}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end justify-between py-0.5 text-right">
        <div className="terminal-font text-sm font-semibold text-cyan-400">
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
