"use client";

/**
 * Two-in-one hook for the /properties page:
 *
 *   ?bubble=<id>      → fetch the saved bubble and rehydrate commandCenterStore
 *                       (persona + filters + polygon). Stale links no-op silently.
 *
 *   ?resume_bubble=1  → the user just completed magic-link sign-in after clicking
 *                       Save while anonymous. Replay the stashed payload from
 *                       sessionStorage, then jump to /dashboard?bubble=<id>.
 */

import { useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";
import { applyBubbleToStore, type Bubble } from "@/lib/bubbles/serialize";
import { consumePendingBubble } from "@/lib/bubbles/useBubbles";

export function useBubbleHydration(): void {
  const searchParams = useSearchParams();
  const router = useRouter();
  const hydrated = useRef<string | null>(null);
  const resumed = useRef(false);

  // ── Resume after auth ────────────────────────────────────────────────────
  useEffect(() => {
    if (resumed.current) return;
    if (searchParams.get("resume_bubble") !== "1") return;
    resumed.current = true;
    (async () => {
      const saved = await consumePendingBubble();
      if (saved) router.replace(`/dashboard?bubble=${encodeURIComponent(saved.id)}`);
      else router.replace("/properties");
    })();
  }, [searchParams, router]);

  const setActivePersona = useCommandCenterStore((s) => s.setActivePersona);
  const setFilters = useCommandCenterStore((s) => s.setFilters);
  const setLocation = useCommandCenterStore((s) => s.setLocation);
  const setCommute = useCommandCenterStore((s) => s.setCommute);
  const setCommutePolygon = useCommandCenterStore((s) => s.setCommutePolygon);
  const setSchool = useCommandCenterStore((s) => s.setSchool);
  const clearDraw = useCommandCenterStore((s) => s.clearDraw);
  const setDrawPolygon = useCommandCenterStore((s) => s.setDrawPolygon);

  useEffect(() => {
    const id = searchParams.get("bubble");
    if (!id || hydrated.current === id) return;
    hydrated.current = id;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/bubbles/${encodeURIComponent(id)}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const { item } = (await res.json()) as { item: Bubble };
        if (cancelled || !item) return;
        applyBubbleToStore(item, {
          setActivePersona,
          setFilters,
          setLocation,
          setCommute,
          setCommutePolygon,
          setSchool,
          clearDraw,
          setDrawPolygon,
        });
      } catch {
        /* stale link or offline — leave Terminal in its current state */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    searchParams,
    setActivePersona,
    setFilters,
    setLocation,
    setCommute,
    setCommutePolygon,
    setSchool,
    clearDraw,
    setDrawPolygon,
  ]);
}
