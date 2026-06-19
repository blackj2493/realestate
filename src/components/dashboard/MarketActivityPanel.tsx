"use client";

import { useEffect, useState } from "react";
import type { ListingDocument } from "@/lib/typesense/client";
import type { MarketActivityLens } from "@/lib/dashboard/config";
import { fetchNewCount, fetchNewListings } from "@/lib/dashboard/queries";
import { areaKey, type Area } from "@/lib/dashboard/area";
import type { SoldListing } from "@/app/api/market/activity/sold/route";
import ActivityRow from "./ActivityRow";
import VowGateOverlay from "@/components/auth/VowGateOverlay";

const LIST_LIMIT = 100; // New side (Typesense, free) — TRREB §6.3(b) per-query display cap
const SOLD_LIST_LIMIT = 25; // Sold side: only ~5 visible (scroll); smaller payload, same cap rules
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
  if (lens.minBeds > 0) p.set("minBeds", String(lens.minBeds));
  if (lens.minBaths > 0) p.set("minBaths", String(lens.minBaths));
  if (lens.minGarage > 0) p.set("minGarage", String(lens.minGarage));
  if (lens.basementFinished) p.set("basement", "1");
  if (lens.minFrontage > 0) p.set("minFrontage", String(lens.minFrontage));
  return p.toString();
}

function Skeleton() {
  return (
    <div className="space-y-px p-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-20 animate-pulse bg-slate-800/40" />
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
    <div className="flex items-baseline justify-between border-b border-slate-800 px-3 py-2">
      <h3 className="terminal-font text-[11px] font-bold uppercase tracking-wider text-slate-200">
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

  const [soldCount, setSoldCount] = useState<number | null>(null);
  const [soldRows, setSoldRows] = useState<SoldListing[] | null>(null);
  const [soldErr, setSoldErr] = useState(false);
  const [soldLocked, setSoldLocked] = useState(false);

  const lensKey = JSON.stringify(lens);
  const key = areaKey(area);

  useEffect(() => {
    let alive = true;
    setNewCount(null);
    setNewRows(null);
    setNewErr(false);
    setSoldCount(null);
    setSoldRows(null);
    setSoldErr(false);
    setSoldLocked(false);

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

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {/* New listings (active / IDX) */}
      <div className="flex flex-col border border-slate-800 bg-slate-900/40">
        <CountHeader title="New Listings" accent="text-cyan-400" count={newCount} />
        <div className="overflow-y-auto md:max-h-[360px]">
          {newRows === null && !newErr && <Skeleton />}
          {newErr && <p className="px-3 py-6 text-center text-xs text-rose-400">Failed to load</p>}
          {newRows && newRows.length === 0 && (
            <p className="px-3 py-6 text-center text-xs text-slate-500">
              No new listings in this window
            </p>
          )}
          {newRows?.map((l) => (
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
              sqft={l.BuildingAreaTotal}
              watchable
            />
          ))}
        </div>
      </div>

      {/* Sold (VOW) — gated: anon sees the count + blurred "Login Required" rows */}
      <div className="flex flex-col border border-slate-800 bg-slate-900/40">
        <CountHeader title="Sold" accent="text-emerald-400" count={soldCount} />
        <div className="overflow-y-auto md:max-h-[360px]">
          {soldLocked ? (
            <div className="relative min-h-[208px]">
              <div className="space-y-2 p-2 blur-sm select-none" aria-hidden="true">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 bg-slate-800/30 p-2">
                    <div className="h-12 w-16 shrink-0 rounded bg-slate-700/50" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3 w-2/3 rounded bg-slate-700/50" />
                      <div className="h-3 w-1/3 rounded bg-slate-700/40" />
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
                <p className="px-3 py-6 text-center text-xs text-slate-500">
                  No sales in this window
                </p>
              )}
              {soldRows?.map((l) => (
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
      </div>
      {/* TRREB §6.3(i)/(k): reliability + bona-fide-interest notice, local to the sold rows. */}
      <p className="text-[10px] leading-snug text-slate-600 md:col-span-2">
        Sold data via TRREB VOW — deemed reliable but not guaranteed accurate by PROPTX; for
        consumers with a bona fide interest only, not for any commercial purpose.
      </p>
    </div>
  );
}
