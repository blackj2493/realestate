"use client";

import { useEffect, useState } from "react";
import { ShoppingCart, Dumbbell, Store } from "lucide-react";
import { searchListings } from "@/lib/typesense/client";

interface NearbyAmenity {
  id: string;
  name: string;
  distanceKm: number;
  address: string;
}

interface AmenitiesResponse {
  grocery: NearbyAmenity[];
  recreation: NearbyAmenity[];
  groceryTotal: number;
  recreationTotal: number;
  /** Nearest Costco warehouse (drive-to; searched beyond the walkable radius). */
  costco: { name: string; distanceKm: number } | null;
}

/**
 * Grocery stores + recreation centres near this home. Like NearbySchools, coordinates
 * aren't reliably in Supabase (geocoded coords live in Typesense), so we resolve the
 * listing's location from the search index, then call /api/amenities/nearby. Renders
 * nothing if location or data is unavailable.
 */
export default function NearbyAmenities({ listingId }: { listingId: string }) {
  const [data, setData] = useState<AmenitiesResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await searchListings({
          query: "*",
          rawFilterBy: `id:=${listingId}`,
          perPage: 1,
        });
        const loc = res.listings[0]?.location;
        if (!loc) return;
        const [lat, lng] = loc;
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

        const r = await fetch(`/api/amenities/nearby?lat=${lat}&lng=${lng}`);
        const json = (await r.json()) as AmenitiesResponse;
        if (!cancelled) setData(json);
      } catch {
        /* best-effort — silently render nothing */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [listingId]);

  if (!data || (data.grocery.length === 0 && data.recreation.length === 0 && !data.costco)) return null;

  return (
    <div className="mb-6">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-200">
        What&apos;s nearby
      </h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <AmenityColumn
          icon={<ShoppingCart className="h-4 w-4 text-emerald-400" />}
          label="Grocery"
          items={data.grocery}
          total={data.groceryTotal}
          accent="text-emerald-400"
          costco={data.costco}
        />
        <AmenityColumn
          icon={<Dumbbell className="h-4 w-4 text-sky-400" />}
          label="Recreation"
          items={data.recreation}
          total={data.recreationTotal}
          accent="text-sky-400"
        />
      </div>
      <p className="mt-3 text-[10px] text-slate-600">
        Places © OpenStreetMap contributors, © Overture Maps Foundation. Distances are
        straight-line to the nearest location, not walking distance.
      </p>
    </div>
  );
}

function AmenityColumn({
  icon,
  label,
  items,
  total,
  accent,
  costco,
}: {
  icon: React.ReactNode;
  label: string;
  items: NearbyAmenity[];
  total: number;
  accent: string;
  /** When provided (Grocery column), pinned as a highlighted Costco row at the top. */
  costco?: { name: string; distanceKm: number } | null;
}) {
  if (items.length === 0 && !costco) return null;
  const shown = items.slice(0, 4);
  const moreCount = Math.max(0, total - shown.length);
  const costcoCity = costco?.name.includes("—") ? costco.name.split("—")[1].trim() : null;

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
      <div className="mb-2 flex items-center gap-2">
        {icon}
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">{label}</span>
      </div>
      <ul className="space-y-1.5">
        {costco && (
          <li className="flex items-start justify-between gap-2 rounded-md bg-amber-500/10 px-1.5 py-1">
            <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium leading-tight text-amber-300">
              <Store className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">Costco{costcoCity ? ` · ${costcoCity}` : ""}</span>
            </span>
            <span className="shrink-0 font-mono text-[11px] font-semibold text-amber-400">
              {costco.distanceKm.toFixed(1)} km
            </span>
          </li>
        )}
        {shown.map((a) => (
          <li key={a.id} className="flex items-start justify-between gap-2">
            <span className="truncate text-sm leading-tight text-slate-200">{a.name}</span>
            <span className={`shrink-0 font-mono text-[11px] ${accent}`}>{a.distanceKm.toFixed(1)} km</span>
          </li>
        ))}
      </ul>
      {moreCount > 0 && (
        <p className="mt-2 text-[11px] text-slate-500">+{moreCount} more within 3 km</p>
      )}
    </div>
  );
}
