"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * useIsMobile — true when the viewport is at/below `maxWidth` px.
 *
 * SSR-safe via useSyncExternalStore: the server snapshot is always `false`
 * (desktop-first), and the client subscribes to a matchMedia change list so it
 * re-renders on rotate/resize. Using the external-store hook (rather than a
 * setState-in-effect) avoids the cascading-render lint and hydration mismatch.
 *
 * Default cutoff 767px = below Tailwind's `md` (phones). Pass a different width
 * to branch at another breakpoint (e.g. 1023 for "below lg" / phones+tablets).
 */
export function useIsMobile(maxWidth = 767): boolean {
  const query = `(max-width: ${maxWidth}px)`;

  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query]
  );

  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query]);

  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

export default useIsMobile;
