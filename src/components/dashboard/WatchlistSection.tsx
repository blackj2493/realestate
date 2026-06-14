"use client";

import Link from "next/link";
import { formatPrice } from "@/lib/utils";
import { useWatchlistStore, type WatchItem } from "@/lib/watchlist/useWatchlist";
import {
  useWatchlistSnapshot,
  type WatchlistChange,
} from "@/lib/watchlist/useWatchlistSnapshot";
import WatchButton from "@/components/watchlist/WatchButton";
import WatchlistSummary from "./WatchlistSummary";
import WatchlistPulseStrip from "./WatchlistPulseStrip";
import { ListingThumbnail } from "@/components/listing/ListingThumbnail";

function Thumb({ item }: { item: WatchItem }) {
  return (
    <ListingThumbnail
      src={item.thumb}
      alt={item.address || "Saved property"}
      className="absolute inset-0"
      sizes="200px"
    />
  );
}

/** "What changed since you saved it" badges, overlaid top-left on the thumbnail. */
function ChangeChips({ change }: { change: WatchlistChange }) {
  const chips: { key: string; text: string; cls: string }[] = [];

  if (change.offMarket) {
    chips.push({
      key: "off",
      text: "Off-market",
      cls: "text-amber-400 bg-amber-400/10 border-amber-400/30",
    });
  } else {
    const d = change.priceDeltaSinceSave;
    if (d != null && d !== 0) {
      const down = d < 0;
      chips.push({
        key: "delta",
        text: `${down ? "▼" : "▲"} ${formatPrice(Math.abs(d))}`,
        cls: down
          ? "text-emerald-400 bg-emerald-400/10 border-emerald-400/30"
          : "text-rose-400 bg-rose-400/10 border-rose-400/30",
      });
    }
    if (change.isStale) {
      chips.push({
        key: "stale",
        text: "Stale",
        cls: "text-rose-400 bg-rose-400/10 border-rose-400/30",
      });
    }
  }

  if (chips.length === 0) return null;

  return (
    <div className="absolute left-1.5 top-1.5 z-10 flex flex-col items-start gap-1">
      {chips.map((c) => (
        <span
          key={c.key}
          className={`terminal-font rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider backdrop-blur ${c.cls}`}
        >
          {c.text}
        </span>
      ))}
    </div>
  );
}

export default function WatchlistSection() {
  const signedIn = useWatchlistStore((s) => s.signedIn);
  const { changes, rollup, loading } = useWatchlistSnapshot();

  if (loading || changes.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between border-b border-slate-800 pb-2">
        <h2 className="terminal-font text-sm font-bold uppercase tracking-widest text-slate-100">
          Watchlist <span className="text-slate-500">· {rollup.count}</span>
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

      <WatchlistSummary rollup={rollup} />
      <WatchlistPulseStrip rollup={rollup} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        {changes.map((change) => {
          const item = change.item;
          const price = change.current?.ListPrice ?? item.list_price;
          const brokerage = change.current?.ListOfficeName;
          return (
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
                  <ChangeChips change={change} />
                </div>
                <div className="p-2">
                  <div className="terminal-font text-xs font-semibold text-cyan-400">
                    {price ? formatPrice(price) : "—"}
                  </div>
                  <p className="truncate text-[11px] text-slate-300">
                    {item.address || "Saved property"}
                  </p>
                  {item.city && (
                    <p className="truncate text-[10px] uppercase tracking-wide text-slate-500">
                      {item.city}
                    </p>
                  )}
                  {/* Listing brokerage (ListOfficeName) — TRREB §6.3(c) mandates the
                      brokerage on EVERY listing shown, including saved/watchlist cards,
                      at the same size/weight as other detail lines (no visual de-emphasis).
                      Re-hydrated live from Typesense via change.current; rendered
                      conditionally so off-market cards (no live doc) never break. */}
                  {brokerage && (
                    <p className="truncate text-[11px] text-slate-300">{brokerage}</p>
                  )}
                </div>
              </Link>
            </div>
          );
        })}
      </div>
    </section>
  );
}
