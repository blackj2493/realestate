"use client";

import { useEffect, useState } from "react";
import type { ListingDocument } from "@/lib/typesense/client";
import type { MarketActivityLens } from "@/lib/dashboard/config";
import { fetchNewCount, fetchNewListings } from "@/lib/dashboard/queries";
import type { SoldListing } from "@/app/api/market/activity/sold/route";
import ActivityRow from "./ActivityRow";

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

function soldQuery(location: string, lens: MarketActivityLens, limit: number): string {
  const p = new URLSearchParams({
    region: location,
    windowDays: String(lens.windowDays),
    limit: String(limit),
  });
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
  location,
  lens,
}: {
  location: string;
  lens: MarketActivityLens;
}) {
  const [newCount, setNewCount] = useState<number | null>(null);
  const [newRows, setNewRows] = useState<ListingDocument[] | null>(null);
  const [newErr, setNewErr] = useState(false);

  const [soldCount, setSoldCount] = useState<number | null>(null);
  const [soldRows, setSoldRows] = useState<SoldListing[] | null>(null);
  const [soldErr, setSoldErr] = useState(false);

  const lensKey = JSON.stringify(lens);

  useEffect(() => {
    let alive = true;
    setNewCount(null);
    setNewRows(null);
    setNewErr(false);
    setSoldCount(null);
    setSoldRows(null);
    setSoldErr(false);

    Promise.all([
      fetchNewCount(location, lens),
      fetchNewListings(location, lens, LIST_LIMIT),
    ])
      .then(([c, rows]) => {
        if (!alive) return;
        setNewCount(c);
        setNewRows(rows);
      })
      .catch((e) => {
        console.error("[MarketActivityPanel:new]", location, e);
        if (alive) setNewErr(true);
      });

    fetch(`/api/market/activity/sold?${soldQuery(location, lens, SOLD_LIST_LIMIT)}`)
      .then((r) => r.json())
      .then((d: { count: number; listings: SoldListing[]; error?: string }) => {
        if (!alive) return;
        if (d.error) throw new Error(d.error);
        setSoldCount(d.count);
        setSoldRows(d.listings);
      })
      .catch((e) => {
        console.error("[MarketActivityPanel:sold]", location, e);
        if (alive) setSoldErr(true);
      });

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location, lensKey]);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {/* New listings (active / IDX) */}
      <div className="flex flex-col border border-slate-800 bg-slate-900/40">
        <CountHeader title="New Listings" accent="text-cyan-400" count={newCount} />
        <div className="max-h-[360px] overflow-y-auto">
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
            />
          ))}
        </div>
      </div>

      {/* Sold (VOW) */}
      <div className="flex flex-col border border-slate-800 bg-slate-900/40">
        <CountHeader title="Sold" accent="text-emerald-400" count={soldCount} />
        <div className="max-h-[360px] overflow-y-auto">
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
              propertySubType={l.propertySubType}
              beds={l.beds}
              baths={l.baths}
              sqft={l.sqft}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
