"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { formatPrice } from "@/lib/utils";
import { getRecentlyViewed, type RecentListing } from "@/lib/dashboard/recentlyViewed";

const PLACEHOLDER =
  "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=200&h=150&fit=crop";

function Thumb({ item }: { item: RecentListing }) {
  const [err, setErr] = useState(false);
  const src = !err && item.thumb && !item.thumb.includes("example.com") ? item.thumb : PLACEHOLDER;
  return (
    <Image
      src={src}
      alt={item.address}
      fill
      className="object-cover"
      unoptimized
      onError={() => setErr(true)}
    />
  );
}

export default function RecentlyViewed() {
  const [items, setItems] = useState<RecentListing[]>([]);

  useEffect(() => {
    setItems(getRecentlyViewed());
  }, []);

  if (items.length === 0) return null;

  return (
    <section className="space-y-3">
      <h2 className="terminal-font border-b border-slate-800 pb-2 text-sm font-bold uppercase tracking-widest text-slate-100">
        Recently Viewed
      </h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        {items.map((item) => (
          <Link
            key={item.id}
            href={`/properties/${item.id}`}
            className="group border border-slate-800 bg-slate-900/40 transition-colors hover:border-slate-600"
          >
            <div className="relative aspect-[4/3] overflow-hidden bg-slate-800">
              <Thumb item={item} />
            </div>
            <div className="p-2">
              <div className="terminal-font text-xs font-semibold text-cyan-400">
                {formatPrice(item.price)}
              </div>
              <p className="truncate text-[11px] text-slate-300">{item.address}</p>
              {item.city && (
                <p className="truncate text-[10px] uppercase tracking-wide text-slate-500">
                  {item.city}
                </p>
              )}
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
