"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatPrice } from "@/lib/utils";
import { getRecentlyViewed, type RecentListing } from "@/lib/dashboard/recentlyViewed";
import { searchListings } from "@/lib/typesense/client";
import { ListingThumbnail } from "@/components/listing/ListingThumbnail";
import ShowMoreButton from "./ShowMoreButton";

const LIMIT = 5;
// TRREB listing-key shape (board letter + 5–10 digits) — a valid Typesense id to backfill.
const KEY_RE = /^[A-Za-z]\d{5,10}$/;

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
    const loaded = getRecentlyViewed();
    setItems(loaded);

    // Backfill brokerage (TRREB §6.3(c)) for legacy snapshots saved before the field
    // shipped — one Typesense round-trip for the active listings among the missing keys.
    const missing = loaded.filter((i) => !i.brokerage && KEY_RE.test(i.id)).map((i) => i.id);
    if (missing.length === 0) return;
    let alive = true;
    searchListings({
      query: "*",
      rawFilterBy: `id:[${missing.join(",")}]`,
      perPage: Math.min(missing.length, 100), // §6.3(b) display cap
    })
      .then((res) => {
        if (!alive) return;
        const office: Record<string, string> = {};
        for (const d of res.listings) if (d.ListOfficeName) office[d.id] = d.ListOfficeName;
        if (Object.keys(office).length === 0) return;
        setItems((prev) =>
          prev.map((i) => (i.brokerage || !office[i.id] ? i : { ...i, brokerage: office[i.id] }))
        );
      })
      .catch(() => {
        /* keep the placeholder fallback on failure */
      });
    return () => {
      alive = false;
    };
  }, []);

  if (items.length === 0) return null;

  const visible = expanded ? items : items.slice(0, LIMIT);

  return (
    <section className="space-y-3">
      <h2 className="terminal-font border-b border-border pb-2 text-sm font-bold uppercase tracking-widest text-foreground">
        Recently Viewed
      </h2>
      {/* Mobile: a snap-scroll rail of larger cards (~62% wide so the next peeks).
          sm+: the original responsive grid. */}
      <div className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 lg:grid-cols-4 xl:grid-cols-6">
        {visible.map((item) => (
          <Link
            key={item.id}
            href={`/properties/${item.id}`}
            className="group w-[62%] shrink-0 snap-start border border-border bg-card/40 transition-colors hover:border-border sm:w-auto sm:shrink"
          >
            <div className="relative aspect-[4/3] overflow-hidden bg-muted">
              <Thumb item={item} />
            </div>
            <div className="p-2">
              <div className="terminal-font text-sm font-bold text-cyan-700 dark:text-cyan-400">
                {formatPrice(item.price)}
              </div>
              <p className="truncate text-xs text-foreground">{item.address}</p>
              {item.city && (
                <p className="truncate text-[11px] uppercase tracking-wide text-muted-foreground">
                  {item.city}
                </p>
              )}
              {/* Listing brokerage (ListOfficeName) — TRREB §6.3(c) mandates the
                  brokerage on EVERY listing shown, including recently-viewed cards, at the
                  same weight as sibling detail lines. New snapshots capture it; legacy ones
                  are backfilled from Typesense above, with a placeholder as the last resort
                  so the attribution line is never simply omitted. */}
              <p className="truncate text-xs text-foreground">{item.brokerage || "Brokerage unavailable"}</p>
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
