"use client";

/**
 * SocialProofBar — honest, deterministic activity counters for a listing.
 *
 * On mount it records this view (deduped server-side per anonymous viewer) and
 * shows the real unique-viewer count plus how many investors are watching it.
 * Numbers are never seeded or inflated — if there's no activity yet, the bar
 * renders nothing rather than showing a fake floor.
 */

import { useEffect, useState } from "react";
import { Eye, Bookmark } from "lucide-react";
import { cn } from "@/lib/utils";

const VIEWER_KEY = "pp_viewer_id";

function getViewerId(): string {
  if (typeof window === "undefined") return "";
  try {
    let id = window.localStorage.getItem(VIEWER_KEY);
    if (!id) {
      id =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `v_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      window.localStorage.setItem(VIEWER_KEY, id);
    }
    return id;
  } catch {
    return "";
  }
}

export default function SocialProofBar({
  listingId,
  className,
  isLease = false,
}: {
  listingId: string;
  className?: string;
  /** Lease listing → the audience is prospective tenants, so "investor" reads as "renter". */
  isLease?: boolean;
}) {
  const noun = isLease ? "renter" : "investor";
  const [stats, setStats] = useState<{ viewers: number; watchers: number } | null>(null);

  useEffect(() => {
    const viewerId = getViewerId();
    if (!viewerId || !listingId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/property/${listingId}/view`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ viewerId }),
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) {
          setStats({ viewers: Number(data?.viewers ?? 0), watchers: Number(data?.watchers ?? 0) });
        }
      } catch {
        /* leave hidden */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [listingId]);

  if (!stats || (stats.viewers <= 0 && stats.watchers <= 0)) return null;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-lg border border-border bg-card px-4 py-2.5 text-xs",
        className
      )}
    >
      {stats.viewers > 0 && (
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Eye className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-400" />
          <span className="font-mono font-semibold text-foreground">
            {stats.viewers.toLocaleString()}
          </span>
          {stats.viewers === 1 ? `${noun} viewed this` : `${noun}s viewed this`}
        </span>
      )}
      {stats.watchers > 0 && (
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Bookmark className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
          <span className="font-mono font-semibold text-foreground">
            {stats.watchers.toLocaleString()}
          </span>
          {stats.watchers === 1 ? `${noun} watching` : "watching"}
        </span>
      )}
    </div>
  );
}
