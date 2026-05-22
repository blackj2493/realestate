"use client";

import { useEffect, useRef } from "react";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";

// Cost-saver debounce: wait after the user stops adjusting before hitting the
// isochrone API (separate from the 250ms Typesense search debounce).
const ISOCHRONE_DEBOUNCE_MS = 500;

/**
 * Fetches the commute isochrone polygon whenever the destination / mode /
 * minutes change, and writes it into the store. Mount once in the terminal.
 */
export function useCommuteIsochrone() {
  const enabled = useCommandCenterStore((s) => s.commute.enabled);
  const destination = useCommandCenterStore((s) => s.commute.destination);
  const mode = useCommandCenterStore((s) => s.commute.mode);
  const minutes = useCommandCenterStore((s) => s.commute.minutes);
  const setCommutePolygon = useCommandCenterStore((s) => s.setCommutePolygon);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);

    if (!enabled || !destination) {
      setCommutePolygon(null);
      return;
    }

    const { lat, lng } = destination;
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch("/api/isochrone", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lat, lng, minutes, mode }),
        });
        if (!res.ok) {
          setCommutePolygon(null);
          return;
        }
        const data = await res.json();
        setCommutePolygon(Array.isArray(data?.polygon) ? data.polygon : null);
      } catch {
        setCommutePolygon(null);
      }
    }, ISOCHRONE_DEBOUNCE_MS);

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [enabled, destination, mode, minutes, setCommutePolygon]);
}
