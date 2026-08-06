"use client";

import { useState } from "react";
import Link from "next/link";
import { formatPrice } from "@/lib/utils";
import ShowMoreButton from "./ShowMoreButton";
import { useWatchlistStore, type WatchItem } from "@/lib/watchlist/useWatchlist";
import {
  useWatchlistSnapshot,
  type WatchlistChange,
} from "@/lib/watchlist/useWatchlistSnapshot";
import WatchButton from "@/components/watchlist/WatchButton";
import WatchlistSummary from "./WatchlistSummary";
import WatchlistPulseStrip from "./WatchlistPulseStrip";
import { ListingThumbnail } from "@/components/listing/ListingThumbnail";
import SignInLink from "@/components/auth/SignInLink";
import { ModuleHead, StatusLight, type StatusTone } from "@/components/daylight/primitives";

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

/** "What changed since you saved it" badges, overlaid top-left on the thumbnail.
 *  Daylight status-lights: solid saturated in light, the current translucent
 *  chip in dark. */
function ChangeChips({ change }: { change: WatchlistChange }) {
  const chips: { key: string; text: string; tone: StatusTone }[] = [];

  if (change.offMarket) {
    const disp = change.disposition;
    if (disp?.kind === "relisted") {
      chips.push({ key: "relisted", text: "Relisted", tone: "relisted" });
    } else if (disp?.kind === "sold") {
      chips.push({ key: "sold", text: "Sold", tone: "sold" });
    } else if (disp?.kind === "leased") {
      chips.push({ key: "leased", text: "Leased", tone: "leased" });
    } else {
      chips.push({ key: "off", text: "Off-market", tone: "off" });
    }
  } else {
    const d = change.priceDeltaSinceSave;
    if (d != null && d !== 0) {
      const down = d < 0;
      chips.push({
        key: "delta",
        text: `${down ? "▼" : "▲"} ${formatPrice(Math.abs(d))}`,
        tone: down ? "drop" : "sold",
      });
    }
    if (change.isStale) {
      chips.push({ key: "stale", text: "Stale", tone: "stale" });
    }
  }

  if (chips.length === 0) return null;

  return (
    <div className="absolute left-1.5 top-1.5 z-10 flex flex-col items-start gap-1">
      {chips.map((c) => (
        <StatusLight key={c.key} tone={c.tone} className="shadow-[0_1px_3px_rgba(10,24,40,0.35)] dark:backdrop-blur">
          {c.text}
        </StatusLight>
      ))}
    </div>
  );
}

const LIMIT = 6;

export default function WatchlistSection() {
  const signedIn = useWatchlistStore((s) => s.signedIn);
  const { changes, rollup, loading } = useWatchlistSnapshot();
  const [expanded, setExpanded] = useState(false);

  // While hydrating, render nothing (the snapshot hook resolves quickly).
  if (loading) return null;

  // Empty watchlist: instead of vanishing, surface an inviting CTA so a fresh
  // high-intent user has an obvious next step (mobile = primary funnel).
  if (changes.length === 0) {
    return (
      <section className="space-y-3">
        <ModuleHead
          title="Watchlist"
          right={
            !signedIn ? (
              <SignInLink className="terminal-font text-[11px] normal-case tracking-wider text-cyan-700 dark:text-cyan-400 hover:underline">
                Sign in to sync across devices →
              </SignInLink>
            ) : undefined
          }
        />

        <div className="border border-dashed border-border bg-card/40 px-6 py-12 text-center">
          <h3 className="terminal-font text-sm font-bold uppercase tracking-widest text-foreground">
            Nothing saved yet
          </h3>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Save listings to track price drops, days-on-market, and status changes —
            all in one place.
          </p>
          <Link
            href="/properties"
            className="terminal-font mt-6 inline-flex min-h-[44px] items-center gap-2 border border-cyan-600/50 bg-cyan-600/10 px-4 py-3 text-xs uppercase tracking-wider text-cyan-700 hover:bg-cyan-600/20 dark:border-cyan-500/50 dark:bg-cyan-500/10 dark:text-cyan-200 dark:hover:bg-cyan-500/20"
          >
            Browse properties →
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <ModuleHead
        title="Watchlist"
        right={
          !signedIn ? (
            <SignInLink className="terminal-font text-[11px] normal-case tracking-wider text-cyan-700 dark:text-cyan-400 hover:underline">
              Sign in to sync across devices →
            </SignInLink>
          ) : undefined
        }
      />

      <WatchlistSummary rollup={rollup} />
      <WatchlistPulseStrip rollup={rollup} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        {(expanded ? changes : changes.slice(0, LIMIT)).map((change) => {
          const item = change.item;
          // A relisted listing follows the property to its new live MLS# (new link + ask).
          const relist = change.disposition?.kind === "relisted" ? change.disposition : null;
          const linkKey = relist?.newKey ?? item.listing_key;
          const price = relist?.newPrice ?? change.current?.ListPrice ?? item.list_price;
          // Live active doc for active cards; for off-market cards the real brokerage is
          // hydrated from the disposition (sold_listings / relist active doc, server-side).
          const brokerage = change.current?.ListOfficeName ?? change.disposition?.brokerage ?? null;
          return (
            <div
              key={item.listing_key}
              className="group relative border border-border bg-card/40 transition-colors hover:border-border"
            >
              <WatchButton
                item={item}
                className="absolute right-1.5 top-1.5 z-10 flex min-h-[44px] min-w-[44px] items-center justify-center rounded bg-background/70 p-1.5 backdrop-blur"
              />
              <Link href={`/properties/${linkKey}`} className="block">
                <div className="relative aspect-[4/3] overflow-hidden bg-muted">
                  <Thumb item={item} />
                  <ChangeChips change={change} />
                </div>
                <div className="p-2">
                  <div className="terminal-font text-sm font-bold text-cyan-700 dark:text-cyan-400">
                    {price ? formatPrice(price) : "—"}
                  </div>
                  <p className="truncate text-xs text-foreground">
                    {item.address || "Saved property"}
                  </p>
                  {item.city && (
                    <p className="truncate text-[11px] uppercase tracking-wide text-muted-foreground">
                      {item.city}
                    </p>
                  )}
                  {/* Listing brokerage (ListOfficeName) — TRREB §6.3(c) mandates the
                      brokerage on EVERY listing shown, including saved/watchlist cards, at
                      the same size/weight as other detail lines. Active cards use the live
                      doc; off-market cards hydrate the real brokerage from the disposition;
                      a "Brokerage unavailable" placeholder is the last-resort fallback so
                      the attribution line is never simply omitted. */}
                  <p className="truncate text-xs text-foreground">{brokerage || "Brokerage unavailable"}</p>
                </div>
              </Link>
            </div>
          );
        })}
      </div>

      {changes.length > LIMIT && (
        <ShowMoreButton
          expanded={expanded}
          hiddenCount={changes.length - LIMIT}
          onToggle={() => setExpanded((v) => !v)}
        />
      )}
    </section>
  );
}
