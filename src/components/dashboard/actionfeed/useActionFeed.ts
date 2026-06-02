"use client";

/**
 * useActionFeed — assembles the "what changed since you last visited" feed from
 * three deterministic sources (§4: no LLM):
 *   1. watchlist listings that went off-market  (most urgent)
 *   2. watchlist listings that dropped in price
 *   3. watchlist listings going stale
 *   4. NEW listings in the user's regions since last visit, narrowed by the active
 *      persona's lead-board filter ("new AND relevant to how this user invests")
 *
 * Watchlist signals reuse useWatchlistSnapshot() (no new diff logic). New listings
 * reuse fetchNewSinceVisit(). Items are normalized to one shape and sorted by
 * urgency, then by magnitude/recency within each tier.
 */

import { useEffect, useMemo, useState } from "react";
import { formatPrice } from "@/lib/utils";
import { useWatchlistSnapshot } from "@/lib/watchlist/useWatchlistSnapshot";
import { fetchNewSinceVisit } from "@/lib/dashboard/queries";
import { regionArea } from "@/lib/dashboard/area";
import { BOARDS } from "@/lib/dashboard/boards";
import { PERSONA_DASHBOARD } from "@/lib/dashboard/personaDashboard";
import type { PersonaType } from "@/lib/personas/personaConfig";
import type { MarketActivityLens } from "@/lib/dashboard/config";

export type FeedKind =
  | "WATCH_OFF_MARKET"
  | "WATCH_PRICE_DROP"
  | "WATCH_STALE"
  | "NEW_LISTING";

export interface FeedItem {
  kind: FeedKind;
  priority: number; // 1 = most urgent
  rank: number; // within-tier sort (desc): |Δ| or EntryTimestamp
  listingKey: string;
  address: string;
  city?: string | null;
  thumb?: string | null;
  price?: number | null;
  brokerage?: string | null; // TRREB §VOW/IDX — brokerage shown on every listing
  headline: string;
  chipText: string;
  chipCls: string;
}

const CHIP = {
  off: "text-amber-400 bg-amber-400/10 border-amber-400/30",
  drop: "text-emerald-400 bg-emerald-400/10 border-emerald-400/30",
  stale: "text-rose-400 bg-rose-400/10 border-rose-400/30",
  new: "text-cyan-400 bg-cyan-400/10 border-cyan-400/30",
} as const;

/** The active persona's lead-board filter clause — defines "relevant" new listings. */
function personaLeadFilter(persona: PersonaType): string | undefined {
  const leadId = PERSONA_DASHBOARD[persona].featuredBoards[0];
  return leadId ? BOARDS[leadId]?.rawFilterBy : undefined;
}

export function useActionFeed({
  regions,
  lens,
  persona,
  sinceMs,
  maxItems = 12,
}: {
  regions: string[];
  lens: MarketActivityLens;
  persona: PersonaType;
  sinceMs: number | null;
  maxItems?: number;
}): { items: FeedItem[]; loading: boolean } {
  const { changes, loading: watchLoading } = useWatchlistSnapshot();

  const [newItems, setNewItems] = useState<FeedItem[]>([]);
  const [newLoading, setNewLoading] = useState(false);

  // Keys already on the watchlist — never duplicate them as "new".
  const watchKeys = useMemo(
    () => new Set(changes.map((c) => c.item.listing_key)),
    [changes]
  );

  const regionsKey = regions.join("|");
  useEffect(() => {
    if (sinceMs == null || regions.length === 0) {
      setNewItems([]);
      return;
    }
    let alive = true;
    setNewLoading(true);
    const extraFilter = personaLeadFilter(persona);
    Promise.allSettled(
      regions.map((r) =>
        fetchNewSinceVisit(regionArea(r), lens, sinceMs, { extraFilter, limit: 10 })
      )
    )
      .then((results) => {
        if (!alive) return;
        const docs = results.flatMap((res) =>
          res.status === "fulfilled" ? res.value : []
        );
        const items: FeedItem[] = docs
          .filter((d) => !watchKeys.has(d.id))
          .map((d) => ({
            kind: "NEW_LISTING" as const,
            priority: 4,
            rank: d.EntryTimestamp ?? 0,
            listingKey: d.id,
            address: d.UnparsedAddress ?? "New listing",
            city: d.City,
            thumb: d.thumbnailUrl ?? d.primaryImageUrl ?? null,
            price: d.ListPrice ?? null,
            brokerage: d.ListOfficeName ?? null,
            headline: "New in your market",
            chipText: "New",
            chipCls: CHIP.new,
          }));
        setNewItems(items);
      })
      .finally(() => alive && setNewLoading(false));
    return () => {
      alive = false;
    };
    // watchKeys folded in via regionsKey/sinceMs; re-running on every key change
    // would thrash, so we read the latest set inside the effect closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regionsKey, sinceMs, persona, lens]);

  const items = useMemo<FeedItem[]>(() => {
    const watch: FeedItem[] = [];
    for (const c of changes) {
      const base = {
        listingKey: c.item.listing_key,
        address: c.item.address ?? c.current?.UnparsedAddress ?? "Saved property",
        city: c.item.city,
        thumb: c.item.thumb ?? c.current?.thumbnailUrl ?? null,
        price: c.current?.ListPrice ?? c.item.list_price ?? null,
        brokerage: c.current?.ListOfficeName ?? null,
      };
      if (c.offMarket) {
        watch.push({
          ...base,
          kind: "WATCH_OFF_MARKET",
          priority: 1,
          rank: 0,
          headline: "Left the market since you saved it",
          chipText: "Off-market",
          chipCls: CHIP.off,
        });
      } else if (c.priceDeltaSinceSave != null && c.priceDeltaSinceSave < 0) {
        const drop = Math.abs(c.priceDeltaSinceSave);
        watch.push({
          ...base,
          kind: "WATCH_PRICE_DROP",
          priority: 2,
          rank: drop,
          headline: `Dropped ${formatPrice(drop)} since you saved it`,
          chipText: `▼ ${formatPrice(drop)}`,
          chipCls: CHIP.drop,
        });
      } else if (c.isStale) {
        watch.push({
          ...base,
          kind: "WATCH_STALE",
          priority: 3,
          rank: c.trueDom ?? 0,
          headline: c.trueDom ? `Going stale · ${c.trueDom} days on market` : "Going stale",
          chipText: "Stale",
          chipCls: CHIP.stale,
        });
      }
    }

    return [...watch, ...newItems]
      .sort((a, b) => (a.priority - b.priority) || (b.rank - a.rank))
      .slice(0, maxItems);
  }, [changes, newItems, maxItems]);

  return { items, loading: watchLoading || newLoading };
}
