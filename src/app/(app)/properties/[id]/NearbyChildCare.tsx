"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Baby, ChevronDown } from "lucide-react";
import { CHILD_CARE_PATH } from "@/lib/childcare/paths";
import { searchListings } from "@/lib/typesense/client";
import type { ChildCareResponse } from "@/app/api/childcare/nearby/route";
import type { NearbyChildCare as Nearby } from "@/lib/childcare/torontoChildCare";

const LIST_LIMIT = 8;

/**
 * Licensed child care within 1 km of a Toronto home. Compact by default: one summary card
 * (centres, infant spaces, $10-a-day, the neighbourhood against the city), with the list of
 * centres behind a "Show" toggle so the block stays short. Like NearbyAmenities, the home's
 * coordinates come from the search index. Renders nothing outside Toronto or on any error.
 */
export default function NearbyChildCare({ listingId }: { listingId: string }) {
  const [data, setData] = useState<Nearby | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await searchListings({ query: "*", rawFilterBy: `id:=${listingId}`, perPage: 1 });
        const loc = res.listings[0]?.location;
        if (!loc) return;
        const [lat, lng] = loc;
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
        const json = (await (await fetch(`/api/childcare/nearby?lat=${lat}&lng=${lng}`)).json()) as ChildCareResponse;
        if (!cancelled && json.covered) setData(json);
      } catch {
        /* best-effort — render nothing */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [listingId]);

  if (!data) return null;
  const km = `${data.radiusKm} km`;
  const shown = data.centres.slice(0, LIST_LIMIT);

  return (
    <div className="mb-6">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-foreground">Child care nearby</h3>
      <div className="rounded-lg border border-border bg-card p-3">
        <div className="flex items-start gap-2">
          <Baby className="mt-0.5 h-4 w-4 shrink-0 text-teal-700 dark:text-teal-400" aria-hidden />
          <div className="min-w-0 text-sm leading-snug">
            {data.count > 0 ? (
              <p className="text-foreground">
                <b>{data.count}</b> licensed {data.count === 1 ? "centre" : "centres"} within {km}
                <span className="text-muted-foreground"> · </span>
                <b>{data.infantSpaces}</b> infant spaces
                {data.infantSpaces > 0 && <span className="text-muted-foreground"> ({data.centresWithInfant} of {data.count} centres)</span>}
                <span className="text-muted-foreground"> · </span>
                <b>{data.cwelccCount}</b> at $10 a day
              </p>
            ) : (
              <p className="text-foreground">No licensed child care centre within {km}.</p>
            )}
            {data.nearestInfant && (
              <p className="mt-1 text-muted-foreground">
                Nearest infant care (under 18 months): {data.nearestInfant.name}, {data.nearestInfant.distanceKm.toFixed(1)} km.
              </p>
            )}
            {data.neighbourhood && (
              <p className="mt-1 text-muted-foreground">
                {data.neighbourhood.name}: <span className="font-semibold text-foreground">{Math.round(data.neighbourhood.per100)}</span> spaces
                per 100 children under 5. Toronto: {Math.round(data.cityPer100)}.{" "}
                <Link href={CHILD_CARE_PATH} className="text-teal-700 underline hover:text-foreground dark:text-teal-400">
                  See the Toronto map
                </Link>
              </p>
            )}
          </div>
        </div>

        {data.count > 0 && (
          <>
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              className="mt-3 flex w-full items-center justify-between rounded-md border border-border px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted/40"
            >
              {open ? "Hide the centres" : `Show the ${data.count} ${data.count === 1 ? "centre" : "centres"}`}
              <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
            </button>
            {open && (
              <ul className="mt-2 divide-y divide-border">
                {shown.map((c) => (
                  <li key={c.id} className="py-2">
                    <div className="flex items-start justify-between gap-2">
                      <span className="truncate text-sm leading-tight text-foreground">{c.name}</span>
                      <span className="shrink-0 font-mono text-[11px] text-teal-700 dark:text-teal-400">{c.distanceKm.toFixed(1)} km</span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {c.infant > 0 && <Tag className="bg-rose-500/10 text-rose-700 dark:text-rose-300">Infant {c.infant}</Tag>}
                      {c.toddler > 0 && <Tag className="bg-sky-500/10 text-sky-700 dark:text-sky-300">Toddler {c.toddler}</Tag>}
                      {c.preschool > 0 && <Tag className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">Preschool {c.preschool}</Tag>}
                      {c.kindergarten + c.schoolAge > 0 && <Tag className="bg-muted text-muted-foreground">School age {c.kindergarten + c.schoolAge}</Tag>}
                      {c.cwelcc && <Tag className="bg-amber-500/10 text-amber-700 dark:text-amber-300">$10/day</Tag>}
                    </div>
                  </li>
                ))}
                {data.count > shown.length && (
                  <li className="pt-2 text-[11px] text-muted-foreground">and {data.count - shown.length} more within {km}</li>
                )}
              </ul>
            )}
          </>
        )}
      </div>
      <p className="mt-2 text-[10px] text-muted-foreground">
        City of Toronto licensed centres, updated {data.updated}. Children under 5: 2021 Census. Spaces are licensed capacity, not open
        spots; most centres have wait lists. Distances are straight-line.
      </p>
    </div>
  );
}

function Tag({ className, children }: { className: string; children: React.ReactNode }) {
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${className}`}>{children}</span>;
}
