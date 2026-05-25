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
    ? "text-slate-400 bg-slate-700/40"
    : s >= 8
    ? "text-emerald-400 bg-emerald-400/10"
    : s >= 6
    ? "text-amber-400 bg-amber-400/10"
    : "text-slate-400 bg-slate-700/40";

/**
 * Schools near this home. Coordinates aren't reliably stored in Supabase (raw lat/lng
 * is usually null; geocoded coords live in Typesense), so we resolve the listing's
 * location from the search index, then reuse the same /api/schools/nearby endpoint
 * the Command Center modal uses. Renders nothing if anything is unavailable.
 */
export default function NearbySchools({ listingId }: { listingId: string }) {
  const [schools, setSchools] = useState<NearbySchool[]>([]);
  const [total, setTotal] = useState(0);

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

  const shown = schools.slice(0, 8);
  const moreCount = Math.max(0, total - shown.length);

  return (
    <div className="mb-6">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-slate-200">
        <GraduationCap className="h-4 w-4 text-emerald-400" />
        Schools near this home
      </h3>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {shown.map((s) => (
          <div key={s.id} className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm leading-tight text-slate-200">{s.name}</p>
              <span
                className={cn(
                  "shrink-0 rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold",
                  scoreColor(s.score)
                )}
              >
                {s.score === null ? "—" : s.score.toFixed(1)}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-500">
              <span className="capitalize">
                {s.system} {s.level}
              </span>
              <span>·</span>
              <span>{s.distanceKm.toFixed(1)} km away</span>
            </div>
          </div>
        ))}
      </div>
      {moreCount > 0 && (
        <p className="mt-2 text-[11px] text-slate-500">+{moreCount} more within 2.5 km</p>
      )}
      <p className="mt-2 text-[10px] text-slate-600">
        PureProperty School Score (0–10) from EQAO data — Government of Ontario, OGL-Ontario.
        Distances are straight-line to the school; proximity is not a guaranteed catchment.
      </p>
    </div>
  );
}
