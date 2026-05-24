"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { formatPrice } from "@/lib/utils";
import { useWatchlistStore, type WatchItem } from "@/lib/watchlist/useWatchlist";
import WatchButton from "@/components/watchlist/WatchButton";

const PLACEHOLDER =
  "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=200&h=150&fit=crop";

function Thumb({ item }: { item: WatchItem }) {
  const [err, setErr] = useState(false);
  const ok = item.thumb && !item.thumb.includes("example.com");
  const src = !err && ok ? item.thumb! : PLACEHOLDER;
  return (
    <Image
      src={src}
      alt={item.address || "Saved property"}
      fill
      className="object-cover"
      unoptimized
      onError={() => setErr(true)}
    />
  );
}

export default function WatchlistSection() {
  const items = useWatchlistStore((s) => Object.values(s.items));
  const signedIn = useWatchlistStore((s) => s.signedIn);
  const loaded = useWatchlistStore((s) => s.loaded);

  if (!loaded || items.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between border-b border-slate-800 pb-2">
        <h2 className="terminal-font text-sm font-bold uppercase tracking-widest text-slate-100">
          Watchlist <span className="text-slate-500">· {items.length}</span>
        </h2>
        {!signedIn && (
          <Link
            href="/login"
            className="terminal-font text-[11px] uppercase tracking-wider text-cyan-400 hover:underline"
          >
            Sign in to sync across devices →
          </Link>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        {items.map((item) => (
          <div
            key={item.listing_key}
            className="group relative border border-slate-800 bg-slate-900/40 transition-colors hover:border-slate-600"
          >
            <WatchButton
              item={item}
              className="absolute right-1.5 top-1.5 z-10 rounded bg-slate-950/70 p-1.5 backdrop-blur"
            />
            <Link href={`/properties/${item.listing_key}`} className="block">
              <div className="relative aspect-[4/3] overflow-hidden bg-slate-800">
                <Thumb item={item} />
              </div>
              <div className="p-2">
                <div className="terminal-font text-xs font-semibold text-cyan-400">
                  {item.list_price ? formatPrice(item.list_price) : "—"}
                </div>
                <p className="truncate text-[11px] text-slate-300">
                  {item.address || "Saved property"}
                </p>
                {item.city && (
                  <p className="truncate text-[10px] uppercase tracking-wide text-slate-500">
                    {item.city}
                  </p>
                )}
              </div>
            </Link>
          </div>
        ))}
      </div>
    </section>
  );
}
