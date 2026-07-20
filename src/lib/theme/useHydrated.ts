"use client";

import { useSyncExternalStore } from "react";

/**
 * True once the client has hydrated; false during SSR and on the first client render.
 *
 * The canonical use is theme-dependent output: the server cannot know the resolved theme
 * (it lives in localStorage), so anything derived from it MUST match the server on the
 * first client render or React reports a hydration mismatch — and for ATTRIBUTES React does
 * not patch the difference, it keeps the server's value. Gate on this, then let the
 * post-hydration re-render deliver the real theme.
 *
 * Implemented with useSyncExternalStore rather than the usual
 * `useState(false)` + `useEffect(() => setMounted(true))`, which is the same thing but
 * trips the "setState synchronously within an effect" lint rule. `subscribe` is a
 * module-level constant so the store is never re-subscribed on re-render.
 */
const subscribe = () => () => {};
const getSnapshot = () => true;
const getServerSnapshot = () => false;

export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
