"use client";

import { useEffect, useState } from "react";
import type { ListingDocument } from "@/lib/typesense/client";
import type { MarketActivityLens } from "@/lib/dashboard/config";
import { fetchNewCount, fetchNewListings } from "@/lib/dashboard/queries";
import { parseLivingAreaRange } from "@/lib/condo/feeStability";
import { areaKey, type Area } from "@/lib/dashboard/area";
import type { SoldListing } from "@/app/api/market/activity/sold/route";
import ActivityRow from "./ActivityRow";
import ShowMoreButton from "./ShowMoreButton";
import VowGateOverlay from "@/components/auth/VowGateOverlay";

const LIST_LIMIT = 100; // New side (Typesense, free) — TRREB §6.3(b) per-query display cap
const SOLD_LIST_LIMIT = 25; // Sold side: only ~5 visible (scroll); smaller payload, same cap rules
// Collapsed row cap — show a short list, then a "Show N more" toggle (same pattern
// as Recently Viewed / Action Feed). Keeps the dashboard short on mobile, where the
// list was previously uncapped (md:max-h only capped desktop) and ran very long.
const ROW_LIMIT = 5;
const DAY_MS = 86_400_000;

function relTime(ts?: number): string {
  if (!ts || !Number.isFinite(ts)) return "";
  const d = Math.floor((Date.now() - ts) / DAY_MS);
  return d <= 0 ? "today" : `${d}d ago`;
}

function soldDateFmt(s?: string | null): string {
  if (!s) return "";
  const d = new Date(s);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}

/**
 * Build the GET query string for /api/market/activity/sold from any Area kind.
 * Region areas pass `?region=`; polygon areas pass `?polygon=lat,lng,...`;
 * school areas pass `?nearby_school=<key>`. Lens filters are shared.
 *
 * A 32-vertex circle polygon serializes to ~770 chars; a typical drawn ring
 * ≤ 20 vertices is well under the 2 KB GET threshold.
 */
function soldQueryParams(area: Area, lens: MarketActivityLens, limit: number): string {
  const p = new URLSearchParams({
    windowDays: String(lens.windowDays),
    limit: String(limit),
  });
  if (area.kind === "region") {
    p.set("region", area.name);
  } else if (area.kind === "school") {
    p.set("nearby_school", area.schoolKey);
  } else {
    p.set("polygon", area.polygon.map(([lat, lng]) => `${lat},${lng}`).join(","));
  }
  if (lens.propertyTypes.length) p.set("types", lens.propertyTypes.join(","));
  if (lens.minBeds > 0) {
    p.set("minBeds", String(lens.minBeds));
    if (lens.bedsExact) p.set("bedsExact", "1");
  }
  if (lens.minBaths > 0) {
    p.set("minBaths", String(lens.minBaths));
    if (lens.bathsExact) p.set("bathsExact", "1");
  }
  if (lens.minGarage > 0) {
    p.set("minGarage", String(lens.minGarage));
    if (lens.garageExact) p.set("garageExact", "1");
  }
  if (lens.basement !== "any") p.set("basement", lens.basement);
  if (lens.minFrontage > 0) p.set("minFrontage", String(lens.minFrontage));
  return p.toString();
}

function Skeleton() {
  return (
    <div className="space-y-px p-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-20 animate-pulse bg-muted/40" />
      ))}
    </div>
  );
}

function CountHeader({
  title,
  accent,
  count,
}: {
  title: string;
  accent: string;
  count: number | null;
}) {
  return (
    <div className="flex items-baseline justify-between border-b border-border px-3 py-2">
      <h3 className="terminal-font text-[11px] font-bold uppercase tracking-wider text-foreground">
        {title}
      </h3>
      <span className={`terminal-font text-xl font-bold ${accent}`}>
        {count == null ? "···" : count.toLocaleString()}
      </span>
    </div>
  );
}

export default function MarketActivityPanel({
  area,
  lens,
}: {
  area: Area;
  lens: MarketActivityLens;
}) {
  const [newCount, setNewCount] = useState<number | null>(null);
  const [newRows, setNewRows] = useState<ListingDocument[] | null>(null);
  const [newErr, setNewErr] = useState(false);
  const [newExpanded, setNewExpanded] = useState(false);

  const [soldCount, setSoldCount] = useState<number | null>(null);
  const [soldRows, setSoldRows] = useState<SoldListing[] | null>(null);
  const [soldErr, setSoldErr] = useState(false);
  const [soldLocked, setSoldLocked] = useState(false);
  const [soldExpanded, setSoldExpanded] = useState(false);

  const lensKey = JSON.stringify(lens);
  const key = areaKey(area);

  useEffect(() => {
    let alive = true;
    setNewCount(null);
    setNewRows(null);
    setNewErr(false);
    setNewExpanded(false);
    setSoldCount(null);
    setSoldRows(null);
    setSoldErr(false);
    setSoldLocked(false);
    setSoldExpanded(false);

    Promise.all([
      fetchNewCount(area, lens),
      fetchNewListings(area, lens, LIST_LIMIT),
    ])
      .then(([c, rows]) => {
        if (!alive) return;
        setNewCount(c);
        setNewRows(rows);
      })
      .catch((e) => {
        console.error("[MarketActivityPanel:new]", key, e);
        if (alive) setNewErr(true);
      });

    // SOLD column now works for every area kind — the sold_listings collection
    // gained `location` + `NearbySchools` in Phase 2B (see soldListingsSchema.ts).
    fetch(`/api/market/activity/sold?${soldQueryParams(area, lens, SOLD_LIST_LIMIT)}`)
      .then((r) => r.json())
      .then((d: { count: number; listings: SoldListing[]; locked?: boolean; error?: string }) => {
        if (!alive) return;
        if (d.error) throw new Error(d.error);
        setSoldCount(d.count);
        setSoldRows(d.listings);
        setSoldLocked(!!d.locked);
      })
      .catch((e) => {
        console.error("[MarketActivityPanel:sold]", key, e);
        if (alive) setSoldErr(true);
      });

    return () => {
      alive = false;
    };
    // `area` captured via `key`; lens via `lensKey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, lensKey]);

  // Collapsed to ROW_LIMIT until the user taps "Show more" — keeps the mobile list short.
  const visibleNew = newRows ? (newExpanded ? newRows : newRows.slice(0, ROW_LIMIT)) : null;
  const visibleSold = soldRows ? (soldExpanded ? soldRows : soldRows.slice(0, ROW_LIMIT)) : null;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {/* New listings (active / IDX) */}
      <div className="flex flex-col border border-border bg-card/40">
        <CountHeader title="New Listings" accent="text-cyan-400" count={newCount} />
        <div>
          {newRows === null && !newErr && <Skeleton />}
          {newErr && <p className="px-3 py-6 text-center text-xs text-rose-400">Failed to load</p>}
          {newRows && newRows.length === 0 && (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              No new listings in this window
            </p>
          )}
          {visibleNew?.map((l) => (
            <ActivityRow
              key={l.id}
              id={l.id}
              address={l.UnparsedAddress || ""}
              city={l.City}
              brokerage={l.ListOfficeName}
              price={l.ListPrice}
              priceLabel="LIST"
              caption={relTime(l.EntryTimestamp)}
              image={l.thumbnailUrl || l.primaryImageUrl}
              propertySubType={l.PropertySubType}
              beds={l.BedroomsTotal}
              baths={l.BathroomsTotalInteger}
              // BuildingAreaTotal is ~never filled for houses; fall back to the
              // LivingAreaRange band midpoint (ActivityRow renders sqft as a number).
              sqft={
                l.BuildingAreaTotal && l.BuildingAreaTotal > 0
                  ? l.BuildingAreaTotal
                  : parseLivingAreaRange(l.LivingAreaRange)
              }
              watchable
            />
          ))}
        </div>
        {newRows && newRows.length > ROW_LIMIT && (
          <ShowMoreButton
            expanded={newExpanded}
            hiddenCount={newRows.length - ROW_LIMIT}
            onToggle={() => setNewExpanded((v) => !v)}
          />
        )}
      </div>

      {/* Sold (VOW) — gated: anon sees the count + blurred "Login Required" rows */}
      <div className="flex flex-col border border-border bg-card/40">
        <CountHeader title="Sold" accent="text-emerald-400" count={soldCount} />
        <div>
          {soldLocked ? (
            <div className="relative min-h-[208px]">
              <div className="space-y-2 p-2 blur-sm select-none" aria-hidden="true">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 bg-muted/30 p-2">
                    <div className="h-12 w-16 shrink-0 rounded bg-muted/50" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3 w-2/3 rounded bg-muted/50" />
                      <div className="h-3 w-1/3 rounded bg-muted/40" />
                    </div>
                    <div className="h-4 w-14 rounded bg-emerald-700/30" />
                  </div>
                ))}
              </div>
              <VowGateOverlay
                message={
                  soldCount && soldCount > 0
                    ? `${soldCount.toLocaleString()} recent sale${soldCount === 1 ? "" : "s"} — sign in to view`
                    : "Sign in to view recent sold comps"
                }
              />
            </div>
          ) : (
            <>
              {soldRows === null && !soldErr && <Skeleton />}
              {soldErr && <p className="px-3 py-6 text-center text-xs text-rose-400">Failed to load</p>}
              {soldRows && soldRows.length === 0 && (
                <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                  No sales in this window
                </p>
              )}
              {visibleSold?.map((l) => (
                <ActivityRow
                  key={l.id}
                  id={l.id}
                  address={l.address}
                  city={l.city}
                  brokerage={l.brokerage}
                  price={l.closePrice}
                  priceLabel="SOLD"
                  caption={soldDateFmt(l.soldDate)}
                  image={l.primaryImageUrl}
                  propertySubType={l.propertySubType}
                  beds={l.beds}
                  baths={l.baths}
                  sqft={l.sqft}
                />
              ))}
            </>
          )}
        </div>
        {!soldLocked && soldRows && soldRows.length > ROW_LIMIT && (
          <ShowMoreButton
            expanded={soldExpanded}
            hiddenCount={soldRows.length - ROW_LIMIT}
            onToggle={() => setSoldExpanded((v) => !v)}
          />
        )}
      </div>
      {/* TRREB §6.3(i)/(k): reliability + bona-fide-interest notice, local to the sold rows. */}
      <p className="text-[10px] leading-snug text-muted-foreground md:col-span-2">
        Sold data via TRREB VOW — deemed reliable but not guaranteed accurate by PROPTX; for
        consumers with a bona fide interest only, not for any commercial purpose.
      </p>
    </div>
  );
}
