"use client";

/**
 * WatchlistAlertsBell — the in-app retention loop.
 *
 * Watches the user's watchlisted properties and lights up when one is now priced
 * below the price it was at when they saved it. Detection is client-side and
 * mirrors the nightly worker (scripts/worker/alerts.ts): compare the current
 * Typesense ListPrice against the saved baseline (WatchItem.list_price).
 *
 * The badge counts only UNSEEN drops — a localStorage "seen" marker records the
 * price the user last acknowledged per listing, so a fresh drop re-lights the bell
 * (the variable reward), and re-opening an unchanged drop does not.
 *
 * Self-contained so it can mount in any header. Deterministic price comparison
 * only (no LLM, §4 compliant).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Bell, X } from "lucide-react";
import { cn, formatPrice } from "@/lib/utils";
import { useWatchlistStore } from "@/lib/watchlist/useWatchlist";
import { searchListings } from "@/lib/typesense/client";

const SEEN_KEY = "pp_alerts_seen";

interface PriceDrop {
  id: string;
  address: string;
  thumb?: string;
  oldPrice: number;
  newPrice: number;
  dropPct: number;
}

function readSeen(): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(SEEN_KEY);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function writeSeen(seen: Record<string, number>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
  } catch {
    /* ignore */
  }
}

export default function WatchlistAlertsBell({ className }: { className?: string }) {
  const items = useWatchlistStore((s) => s.items);
  const loaded = useWatchlistStore((s) => s.loaded);
  const init = useWatchlistStore((s) => s.init);

  const [open, setOpen] = useState(false);
  const [drops, setDrops] = useState<PriceDrop[]>([]);
  const [seen, setSeen] = useState<Record<string, number>>({});
  const seenLoaded = useRef(false);

  // Hydrate the watchlist store (idempotent) and the seen-marker once.
  useEffect(() => {
    void init();
    if (!seenLoaded.current) {
      seenLoaded.current = true;
      setSeen(readSeen());
    }
  }, [init]);

  // Stable key of watched ids → only refetch when the set actually changes.
  const watchedIds = useMemo(() => Object.keys(items).sort(), [items]);
  const idsKey = watchedIds.join(",");

  // Look up current prices for watched ids and diff against each saved baseline.
  useEffect(() => {
    if (!loaded || watchedIds.length === 0) {
      setDrops([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await searchListings({
          query: "*",
          rawFilterBy: `id:[${watchedIds.join(",")}]`,
          perPage: watchedIds.length,
        });
        if (cancelled) return;
        const byId = new Map(res.listings.map((l) => [l.id, l]));
        const found: PriceDrop[] = [];
        for (const id of watchedIds) {
          const item = items[id];
          const cur = byId.get(id);
          const baseline = item?.list_price;
          const newPrice = cur?.ListPrice;
          if (!baseline || !newPrice || newPrice >= baseline) continue;
          found.push({
            id,
            address: cur?.UnparsedAddress || item.address || item.city || "Watched property",
            thumb: cur?.thumbnailUrl || cur?.primaryImageUrl || item.thumb,
            oldPrice: baseline,
            newPrice,
            dropPct: Math.round(((baseline - newPrice) / baseline) * 100),
          });
        }
        found.sort((a, b) => b.dropPct - a.dropPct);
        setDrops(found);
      } catch {
        if (!cancelled) setDrops([]);
      }
    })();
    return () => {
      cancelled = true;
    };
    // idsKey captures membership changes; items read inside is fine for current prices.
  }, [idsKey, loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // A drop is "unseen" until the user has acknowledged this exact new price.
  const unseenCount = useMemo(
    () => drops.filter((d) => seen[d.id] !== d.newPrice).length,
    [drops, seen]
  );

  // Opening the panel acknowledges every current drop at its current price.
  const handleOpen = () => {
    setOpen(true);
    if (drops.length > 0) {
      const next = { ...seen };
      for (const d of drops) next[d.id] = d.newPrice;
      setSeen(next);
      writeSeen(next);
    }
  };

  return (
    <div className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : handleOpen())}
        aria-label={`Watchlist alerts${unseenCount ? ` (${unseenCount} new)` : ""}`}
        aria-expanded={open}
        className="relative inline-flex h-11 w-11 items-center justify-center border border-slate-700 text-slate-300 transition-colors hover:border-cyan-500/60 hover:text-cyan-300"
      >
        <Bell className="h-4 w-4" />
        {unseenCount > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 font-mono text-[10px] font-bold text-white">
            {unseenCount > 9 ? "9+" : unseenCount}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* Backdrop closes the panel */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />

          <div className="absolute right-0 top-11 z-50 w-[min(20rem,calc(100vw-1rem))] border border-slate-700 bg-slate-950 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-200">
                Price-Drop Alerts
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="-my-2 -mr-1 inline-flex h-11 w-11 items-center justify-center text-slate-500 transition-colors hover:text-slate-300"
                aria-label="Close alerts"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="max-h-[70dvh] overflow-y-auto pb-safe">
              {drops.length === 0 ? (
                <div className="px-3 py-6 text-center text-xs text-slate-500">
                  {watchedIds.length === 0
                    ? "Save properties to your watchlist to get price-drop alerts."
                    : "No price drops on your watchlist yet."}
                </div>
              ) : (
                drops.map((d) => (
                  <Link
                    key={d.id}
                    href={`/properties/${d.id}`}
                    onClick={() => setOpen(false)}
                    className="flex items-start gap-3 border-b border-slate-800/60 px-3 py-2.5 transition-colors hover:bg-slate-900/60"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-slate-200">{d.address}</p>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        <span className="text-slate-500 line-through">{formatPrice(d.oldPrice)}</span>{" "}
                        <span className="font-mono text-emerald-400">{formatPrice(d.newPrice)}</span>
                      </p>
                    </div>
                    <span className="shrink-0 rounded-sm bg-rose-500/15 px-1.5 py-0.5 font-mono text-[11px] font-bold text-rose-300">
                      -{d.dropPct}%
                    </span>
                  </Link>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
