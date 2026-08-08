"use client";

import { useEffect, useState } from "react";
import { GraduationCap } from "lucide-react";
import { cn } from "@/lib/utils";
import { searchListings } from "@/lib/typesense/client";

interface NearbySchool {
  id: string;
  name: string;
  level: "elementary" | "secondary";
  system: "public" | "catholic";
  score: number | null;
  distanceKm: number;
}

const scoreColor = (s: number | null) =>
  s === null
    ? "text-muted-foreground bg-muted/40"
    : s >= 8
    ? "text-emerald-700 dark:text-emerald-400 bg-emerald-400/10"
    : s >= 6
    ? "text-amber-700 dark:text-amber-400 bg-amber-400/10"
    : "text-muted-foreground bg-muted/40";

/**
 * Schools near this home. Coordinates aren't reliably stored in Supabase (raw lat/lng
 * is usually null; geocoded coords live in Typesense), so we resolve the listing's
 * location from the search index, then reuse the same /api/schools/nearby endpoint
 * the Command Center modal uses. Renders nothing if anything is unavailable.
 */
export default function NearbySchools({ listingId }: { listingId: string }) {
  const [schools, setSchools] = useState<NearbySchool[]>([]);
  const [total, setTotal] = useState(0);
  // Compact by default — the list can run long; show the nearest few and let the user expand.
  const [expanded, setExpanded] = useState(false);

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

        const r = await fetch(`/api/schools/nearby?lat=${lat}&lng=${lng}`);
        const data = await r.json();
        if (cancelled) return;
        setSchools(Array.isArray(data?.results) ? data.results : []);
        setTotal(typeof data?.total === "number" ? data.total : 0);
      } catch {
        /* schools are best-effort — silently render nothing */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [listingId]);

  if (schools.length === 0) return null;

  const list = schools.slice(0, 8);
  const COLLAPSED = 3; // nearest few; the rest are one tap away
  const visible = expanded ? list : list.slice(0, COLLAPSED);
  const hiddenInList = list.length - COLLAPSED;
  const moreCount = Math.max(0, total - list.length);

  return (
    <div className="mb-6">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-foreground">
        <GraduationCap className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
        Schools near this home
        <span className="font-mono text-xs font-normal normal-case tracking-normal text-muted-foreground">
          · {list.length}
          {moreCount > 0 ? "+" : ""}
        </span>
      </h3>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {visible.map((s) => (
          <div key={s.id} className="rounded-lg border border-border bg-card p-3">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm leading-tight text-foreground">{s.name}</p>
              <span
                className={cn(
                  "shrink-0 rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold",
                  scoreColor(s.score)
                )}
              >
                {s.score === null ? "—" : s.score.toFixed(1)}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
              <span className="capitalize">
                {s.system} {s.level}
              </span>
              <span>·</span>
              <span>{s.distanceKm.toFixed(1)} km away</span>
            </div>
          </div>
        ))}
      </div>
      {hiddenInList > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 min-h-[44px] text-xs font-medium text-cyan-700 dark:text-cyan-400 transition-colors hover:text-cyan-600 dark:hover:text-cyan-300 md:min-h-0"
        >
          {expanded
            ? "Show fewer schools ▴"
            : `Show ${hiddenInList} more school${hiddenInList === 1 ? "" : "s"} ▾`}
        </button>
      )}
      {moreCount > 0 && (
        <p className="mt-2 text-[11px] text-muted-foreground">+{moreCount} more within 2.5 km</p>
      )}
      <p className="mt-2 text-[10px] text-muted-foreground">
        PureProperty School Score (0–10) from EQAO data — Government of Ontario, OGL-Ontario.
        Distances are straight-line to the school; proximity is not a guaranteed catchment.
      </p>
    </div>
  );
}
