"use client";

/**
 * Watchlist Pulse data layer.
 *
 * Re-fetches the CURRENT Typesense document for every saved listing and diffs it
 * against the snapshot stored at save time (`WatchItem.list_price` / `.status`).
 * This powers the "what changed since you saved it" feed + the portfolio rollup.
 *
 * Signals (all from populated index fields):
 *  - priceDeltaSinceSave — current ListPrice − your saved price (negative = drop).
 *  - totalPriceDrop      — the listing's own $ drop from its original ask.
 *  - trueDom / isStale   — Temporal Distress Engine staleness.
 *  - offMarket           — saved key no longer in the active index (sold/terminated/
 *                          expired). The active collection only holds live listings,
 *                          so absence IS the off-market signal.
 *
 * Deterministic comparison only — no raw IDX/VOW data is passed through any LLM (§4).
 */

import { useEffect, useMemo, useState } from "react";
import { searchListings, type ListingDocument } from "@/lib/typesense/client";
import { dealScoreFromDocument } from "@/lib/dealScore/fromListingDocument";
import { useWatchlistStore, type WatchItem } from "./useWatchlist";

// TRREB listing keys: a board letter + 5–10 digits (e.g. W12632618). Anything else
// can't be a Typesense id, so we exclude it from the fetch (treated as off-market).
const KEY_RE = /^[A-Za-z]\d{5,10}$/;

export interface WatchlistChange {
  item: WatchItem; // stored snapshot (price/status at save time)
  current?: ListingDocument; // live doc; undefined when off-market
  offMarket: boolean;
  priceDeltaSinceSave?: number; // current.ListPrice − item.list_price
  totalPriceDrop?: number; // listing's own drop from original ask
  trueDom?: number;
  isStale: boolean;
}

/**
 * Aggregates that CHARACTERIZE the saved set — never sum-style "portfolio" metrics
 * (total value / total carry imply you own or are buying all of them, which a
 * watchlist is not; owned holdings belong in a separate Portfolio section).
 */
export interface WatchlistRollup {
  count: number;
  minPrice: number | null; // price band you're watching
  maxPrice: number | null;
  avgCapRate: number | null; // yield quality of what you tend to save
  bestDeal: { score: number; grade: string; address?: string } | null; // strongest buy right now
  priceDrops: number; // items cheaper than when you saved them
  offMarket: number;
  goingStale: number;
}

export interface WatchlistSnapshot {
  changes: WatchlistChange[];
  rollup: WatchlistRollup;
  loading: boolean;
}

export function useWatchlistSnapshot(): WatchlistSnapshot {
  // Select the stable map reference, derive the array in a memo — never run
  // Object.values() inside the selector (unstable snapshot → infinite loop).
  const itemsMap = useWatchlistStore((s) => s.items);
  const loaded = useWatchlistStore((s) => s.loaded);
  const items = useMemo(() => Object.values(itemsMap), [itemsMap]);

  // A stable, order-independent cache key so the fetch only re-runs when the SET
  // of saved listings changes (not on every render / unrelated store update).
  const keyParam = useMemo(
    () =>
      items
        .map((i) => i.listing_key)
        .filter((k) => KEY_RE.test(k))
        .sort()
        .join(","),
    [items]
  );

  const [docs, setDocs] = useState<Record<string, ListingDocument>>({});
  const [loading, setLoading] = useState(false);
  // Until the first fetch resolves we must NOT treat saved listings as off-market
  // (docs is empty initially) — that would flash "off-market" on every card.
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!keyParam) {
      setDocs({});
      setHydrated(true);
      return;
    }
    let alive = true;
    setLoading(true);
    const keys = keyParam.split(",");
    searchListings({
      query: "*",
      rawFilterBy: `id:[${keys.join(",")}]`,
      perPage: Math.min(keys.length, 100), // TRREB §6.3(b) display cap
    })
      .then((res) => {
        if (!alive) return;
        const map: Record<string, ListingDocument> = {};
        for (const d of res.listings) map[d.id] = d;
        setDocs(map);
        // Mark hydrated only on SUCCESS — otherwise a transient search error
        // (empty docs) would render every saved listing as "off-market".
        setHydrated(true);
      })
      .catch(() => {
        /* keep last-good docs; do not flip listings to off-market on a blip */
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [keyParam]);

  const changes = useMemo<WatchlistChange[]>(
    () =>
      items.map((item) => {
        const current = docs[item.listing_key];
        const priceDeltaSinceSave =
          current && item.list_price != null
            ? current.ListPrice - item.list_price
            : undefined;
        return {
          item,
          current,
          offMarket: hydrated && !current,
          priceDeltaSinceSave,
          totalPriceDrop: current?.TotalPriceDrop,
          trueDom: current?.TrueDom,
          isStale: !!current?.IsStale,
        };
      }),
    [items, docs, hydrated]
  );

  const rollup = useMemo<WatchlistRollup>(() => {
    let minPrice: number | null = null;
    let maxPrice: number | null = null;
    let capSum = 0;
    let capN = 0;
    let priceDrops = 0;
    let offMarket = 0;
    let goingStale = 0;
    let bestDeal: WatchlistRollup["bestDeal"] = null;

    for (const c of changes) {
      const price = c.current?.ListPrice ?? c.item.list_price;
      if (price != null && price > 0) {
        minPrice = minPrice == null ? price : Math.min(minPrice, price);
        maxPrice = maxPrice == null ? price : Math.max(maxPrice, price);
      }

      const cap = c.current?.ExtrapolatedCapRate;
      if (cap != null && cap > 0) {
        capSum += cap;
        capN += 1;
      }

      if (c.current) {
        const ds = dealScoreFromDocument(c.current);
        if (ds.score != null && ds.grade && (!bestDeal || ds.score > bestDeal.score)) {
          bestDeal = {
            score: ds.score,
            grade: ds.grade,
            address: c.item.address ?? c.current.UnparsedAddress,
          };
        }
      }

      if (c.priceDeltaSinceSave != null && c.priceDeltaSinceSave < 0) priceDrops += 1;
      if (c.offMarket) offMarket += 1;
      if (c.isStale) goingStale += 1;
    }

    return {
      count: changes.length,
      minPrice,
      maxPrice,
      avgCapRate: capN ? capSum / capN : null,
      bestDeal,
      priceDrops,
      offMarket,
      goingStale,
    };
  }, [changes]);

  return { changes, rollup, loading: loading || !loaded };
}
