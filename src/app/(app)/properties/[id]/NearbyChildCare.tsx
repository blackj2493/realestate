"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Baby, ChevronDown } from "lucide-react";
import { CHILD_CARE_PATH } from "@/lib/childcare/paths";
import { searchListings } from "@/lib/typesense/client";
import type { ChildCareResponse, OntarioChildCareResponse, TorontoChildCareResponse } from "@/app/api/childcare/nearby/route";

/** Centres shown before "Show all". */
const PREVIEW = 3;
/** Centres shown after "Show all" (a dense 1 km circle downtown can hold 40+). */
const LIST_MAX = 15;

type Row = { id: string | number; name: string; distanceKm: number; tags: { label: string; className: string }[] };

const INFANT_TAG = "bg-rose-500/10 text-rose-700 dark:text-rose-300";
const CWELCC_TAG = "bg-amber-500/10 text-amber-700 dark:text-amber-300";
const MUTED_TAG = "bg-muted text-muted-foreground";

/**
 * Licensed child care within 1 km of a home. Short by design (owner call 2026-11-25: "all
 * this text isn't going to be read"): one headline line, the nearest three centres, a
 * "Show all" toggle for the rest, and a one-line source. Two scopes from the API:
 *   - Toronto (City data): infant and $10-a-day tags, the neighbourhood vs the city;
 *   - elsewhere in Ontario (ministry list): a count and a half-day tag; locations are
 *     approximate (postal code).
 * Like NearbyAmenities, the home's coordinates come from the search index. Renders nothing
 * when the API says `covered: false` or on any error.
 */
export default function NearbyChildCare({ listingId }: { listingId: string }) {
  const [data, setData] = useState<TorontoChildCareResponse | OntarioChildCareResponse | null>(null);

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
  return data.scope === "ontario" ? <OntarioCard data={data} /> : <TorontoCard data={data} />;
}

function TorontoCard({ data }: { data: TorontoChildCareResponse }) {
  const rows: Row[] = data.centres.map((c) => ({
    id: c.id,
    name: c.name,
    distanceKm: c.distanceKm,
    tags: [
      ...(c.infant > 0 ? [{ label: "Infant", className: INFANT_TAG }] : []),
      ...(c.cwelcc ? [{ label: "$10/day", className: CWELCC_TAG }] : []),
    ],
  }));
  const stats = data.count > 0 ? [`${data.centresWithInfant} with infant care`, `${data.cwelccCount} at $10/day`] : [];
  // Only worth a line when no centre inside the circle takes infants.
  const farInfant = data.centresWithInfant === 0 && data.nearestInfant ? data.nearestInfant : null;

  return (
    <Card
      count={data.count}
      km={data.radiusKm}
      stats={stats}
      rows={rows}
      extra={
        (farInfant || data.neighbourhood) && (
          <>
            {farInfant && (
              <p>
                Nearest infant care: {farInfant.name}, {farInfant.distanceKm.toFixed(1)} km
              </p>
            )}
            {data.neighbourhood && (
              <p>
                {data.neighbourhood.name}: {Math.round(data.neighbourhood.per100)} spaces per 100 kids (Toronto{" "}
                {Math.round(data.cityPer100)}) ·{" "}
                <Link href={CHILD_CARE_PATH} className="text-teal-700 underline hover:text-foreground dark:text-teal-400">
                  Map
                </Link>
              </p>
            )}
          </>
        )
      }
      source={`City of Toronto, ${data.updated}. Licensed spaces, not open spots.`}
    />
  );
}

function OntarioCard({ data }: { data: OntarioChildCareResponse }) {
  const rows: Row[] = data.centres.map((c) => ({
    id: c.id,
    name: c.name,
    distanceKm: c.distanceKm,
    tags: c.fullDay ? [] : [{ label: "Half day", className: MUTED_TAG }],
  }));
  const stats = data.count > 0 && data.fullDayCount < data.count ? [`${data.fullDayCount} full day`] : [];
  return (
    <Card
      count={data.count}
      km={data.radiusKm}
      stats={stats}
      rows={rows}
      source={`Ontario Ministry of Education, ${data.updated}. Approximate locations. Licensed centres, not open spots.`}
    />
  );
}

function Card({
  count,
  km,
  stats,
  rows,
  extra,
  source,
}: {
  count: number;
  km: number;
  stats: string[];
  rows: Row[];
  extra?: React.ReactNode;
  source: string;
}) {
  const [open, setOpen] = useState(false);
  const shown = rows.slice(0, open ? LIST_MAX : PREVIEW);
  const hidden = count - shown.length;

  return (
    <div className="mb-6">
      {/* The phone shows MobileCollapse's "Child care" header instead. */}
      <h3 className="mb-3 hidden text-sm font-semibold uppercase tracking-wider text-foreground lg:block">Child care nearby</h3>
      <div className="rounded-lg border border-border bg-card p-3">
        <div className="flex items-center gap-2 text-sm">
          <Baby className="h-4 w-4 shrink-0 text-teal-700 dark:text-teal-400" aria-hidden />
          {count > 0 ? (
            <p className="text-foreground">
              <b>{count}</b> {count === 1 ? "centre" : "centres"} within {km} km
              {stats.length > 0 && <span className="text-muted-foreground"> · {stats.join(" · ")}</span>}
            </p>
          ) : (
            <p className="text-foreground">No licensed centre within {km} km</p>
          )}
        </div>

        {shown.length > 0 && (
          <ul className="mt-2 divide-y divide-border">
            {shown.map((c) => (
              <li key={c.id} className="flex items-center gap-2 py-2">
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">{c.name}</span>
                {c.tags.map((t) => (
                  <span key={t.label} className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${t.className}`}>
                    {t.label}
                  </span>
                ))}
                <span className="w-12 shrink-0 text-right font-mono text-[11px] text-teal-700 dark:text-teal-400">
                  {c.distanceKm.toFixed(1)} km
                </span>
              </li>
            ))}
          </ul>
        )}

        {count > PREVIEW && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="mt-1 flex items-center gap-1 py-1 text-xs font-semibold text-teal-700 hover:text-foreground dark:text-teal-400"
          >
            {open ? "Show less" : `Show all ${count}`}
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
          </button>
        )}
        {open && hidden > 0 && <p className="mt-1 text-[11px] text-muted-foreground">and {hidden} more within {km} km</p>}

        {extra && <div className="mt-2 space-y-1 border-t border-border pt-2 text-xs text-muted-foreground">{extra}</div>}
      </div>
      <p className="mt-2 text-[10px] text-muted-foreground">{source}</p>
    </div>
  );
}
