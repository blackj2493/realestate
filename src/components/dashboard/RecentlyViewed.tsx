"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatPrice } from "@/lib/utils";
import { getRecentlyViewed, type RecentListing } from "@/lib/dashboard/recentlyViewed";
import { ListingThumbnail } from "@/components/listing/ListingThumbnail";
import ShowMoreButton from "./ShowMoreButton";

const LIMIT = 5;

function Thumb({ item }: { item: RecentListing }) {
  return (
    <ListingThumbnail
      src={item.thumb}
      alt={item.address}
      className="absolute inset-0"
      sizes="(max-width: 768px) 50vw, 200px"
    />
  );
}

export default function RecentlyViewed() {
  const [items, setItems] = useState<RecentListing[]>([]);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setItems(getRecentlyViewed());
  }, []);

  if (items.length === 0) return null;

  const visible = expanded ? items : items.slice(0, LIMIT);

  return (
    <section className="space-y-3">
      <h2 className="terminal-font border-b border-slate-800 pb-2 text-sm font-bold uppercase tracking-widest text-slate-100">
        Recently Viewed
      </h2>
      {/* Mobile: a snap-scroll rail of larger cards (~62% wide so the next peeks).
          sm+: the original responsive grid. */}
      <div className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 lg:grid-cols-4 xl:grid-cols-6">
        {visible.map((item) => (
          <Link
            key={item.id}
            href={`/properties/${item.id}`}
            className="group w-[62%] shrink-0 snap-start border border-slate-800 bg-slate-900/40 transition-colors hover:border-slate-600 sm:w-auto sm:shrink"
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
              {/* Listing brokerage (ListOfficeName) — TRREB §6.3(c) mandates the
                  brokerage on EVERY listing shown, including recently-viewed
                  cards, at the same weight as sibling detail lines. Conditional:
                  snapshots saved before this field shipped omit it. */}
              {item.brokerage && (
                <p className="truncate text-[11px] text-slate-300">{item.brokerage}</p>
              )}
            </div>
          </Link>
        ))}
      </div>

      {items.length > LIMIT && (
        <ShowMoreButton
          expanded={expanded}
          hiddenCount={items.length - LIMIT}
          onToggle={() => setExpanded((v) => !v)}
        />
      )}
    </section>
  );
}
