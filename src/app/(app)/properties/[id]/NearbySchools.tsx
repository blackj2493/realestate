"use client";

import { useEffect, useState } from "react";
import { GraduationCap } from "lucide-react";
import { cn } from "@/lib/utils";
import { searchListings } from "@/lib/typesense/client";
import { kindsWithoutZone, PROGRAM_LABEL, type ZonedSchool } from "@/lib/schools/zonedSchools";

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

const SYSTEM_LABEL = { public: "Public", catholic: "Catholic" } as const;

function SchoolCard({ s, program }: { s: NearbySchool; program?: ZonedSchool["program"] }) {
  const programLabel = program ? PROGRAM_LABEL[program] : null;
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm leading-tight text-foreground">{s.name}</p>
        <span className={cn("shrink-0 rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold", scoreColor(s.score))}>
          {s.score === null ? "—" : s.score.toFixed(1)}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
        <span>
          {SYSTEM_LABEL[s.system]} {s.level}
        </span>
        {programLabel && (
          <>
            <span>·</span>
            <span className="font-medium text-sky-700 dark:text-sky-400">{programLabel}</span>
          </>
        )}
        <span>·</span>
        <span>{s.distanceKm.toFixed(1)} km away</span>
      </div>
    </div>
  );
}

const SCORE_NOTE = "PureProperty School Score (0–10) from EQAO data — Government of Ontario, OGL-Ontario.";

/**
 * Schools for this home. Leads with the ZONED schools — the boundaries that contain the
 * home, from the listing's `SchoolCatchments` index field — then the other schools nearby.
 *
 * Until 2026-11 this block listed every school within 2.5 km, nearest first, so the
 * nearest school often stood in for the zoned one and the zoned Catholic school was often
 * missing (see src/lib/schools/zonedSchools.ts). With no boundary on file for the address,
 * it falls back to the nearby list and says that proximity is not a catchment.
 *
 * Coordinates aren't reliably stored in Supabase (raw lat/lng is usually null; geocoded
 * coords live in Typesense), so the listing is resolved from the search index first.
 * Renders nothing if anything is unavailable.
 */
export default function NearbySchools({ listingId }: { listingId: string }) {
  const [nearby, setNearby] = useState<NearbySchool[]>([]);
  const [zoned, setZoned] = useState<ZonedSchool[]>([]);
  const [total, setTotal] = useState(0);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await searchListings({ query: "*", rawFilterBy: `id:=${listingId}`, perPage: 1 });
        const doc = res.listings[0];
        const loc = doc?.location;
        if (!loc) return;
        const [lat, lng] = loc;
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

        const tokens = Array.isArray(doc.SchoolCatchments) ? doc.SchoolCatchments : [];
        const params = new URLSearchParams({ lat: String(lat), lng: String(lng) });
        if (tokens.length) params.set("zoned", tokens.join(","));
        const r = await fetch(`/api/schools/nearby?${params}`);
        const data = await r.json();
        if (cancelled) return;
        setNearby(Array.isArray(data?.results) ? data.results : []);
        setZoned(Array.isArray(data?.zoned) ? data.zoned : []);
        setTotal(typeof data?.total === "number" ? data.total : 0);
      } catch {
        /* schools are best-effort — silently render nothing */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [listingId]);

  if (zoned.length === 0 && nearby.length === 0) return null;

  // ── No boundary on file: the nearby list, labelled as such ──────────────────────────
  if (zoned.length === 0) {
    const list = nearby.slice(0, 8);
    const COLLAPSED = 3;
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
        <p className="mb-2 text-xs text-muted-foreground">
          We have no school board boundaries for this address. These are the nearest schools, and the nearest
          school is not always the zoned one. Check with the school board.
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {visible.map((s) => (
            <SchoolCard key={s.id} s={s} />
          ))}
        </div>
        {hiddenInList > 0 && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-2 min-h-[44px] text-xs font-medium text-cyan-700 dark:text-cyan-400 transition-colors hover:text-cyan-600 dark:hover:text-cyan-300 md:min-h-0"
          >
            {expanded ? "Show fewer schools ▴" : `Show ${hiddenInList} more school${hiddenInList === 1 ? "" : "s"} ▾`}
          </button>
        )}
        {moreCount > 0 && <p className="mt-2 text-[11px] text-muted-foreground">+{moreCount} more within 2.5 km</p>}
        <p className="mt-2 text-[10px] text-muted-foreground">{SCORE_NOTE} Distances are straight-line to the school.</p>
      </div>
    );
  }

  // ── Zoned schools first, then the rest nearby ──────────────────────────────────────
  const zonedIds = new Set(zoned.map((z) => z.id));
  const others = nearby.filter((s) => !zonedIds.has(s.id)).slice(0, 8);
  const missing = kindsWithoutZone(zoned);

  return (
    <div className="mb-6">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-foreground">
        <GraduationCap className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
        Zoned schools for this home
        <span className="font-mono text-xs font-normal normal-case tracking-normal text-muted-foreground">
          · {zoned.length}
        </span>
      </h3>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {zoned.map((s) => (
          <SchoolCard key={`${s.id}|${s.program}`} s={s} program={s.program} />
        ))}
      </div>
      {missing.length > 0 && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          No board boundary on file for the {missing.join(", ")} school
          {missing.length === 1 ? "" : "s"}. Check with the school board.
        </p>
      )}
      {others.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="mt-2 min-h-[44px] text-xs font-medium text-cyan-700 dark:text-cyan-400 transition-colors hover:text-cyan-600 dark:hover:text-cyan-300 md:min-h-0"
          >
            {expanded
              ? "Hide other schools nearby ▴"
              : `Show ${others.length} other school${others.length === 1 ? "" : "s"} nearby ▾`}
          </button>
          {expanded && (
            <>
              <p className="mb-2 mt-1 text-[11px] text-muted-foreground">
                Within 2.5 km, but this home is not in their zone.
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {others.map((s) => (
                  <SchoolCard key={s.id} s={s} />
                ))}
              </div>
            </>
          )}
        </>
      )}
      <p className="mt-2 text-[10px] text-muted-foreground">
        Zones come from each school board&apos;s published boundary file. Boards change boundaries, so confirm with
        the board before you buy. {SCORE_NOTE}
      </p>
    </div>
  );
}
