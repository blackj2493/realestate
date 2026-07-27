"use client";

import { useSyncExternalStore } from "react";

/**
 * useIsMac — true on macOS, where keyboard shortcuts use the ⌘ (Command) glyph.
 * Every other platform (Windows / Linux) uses Ctrl, so any shortcut HINT we print
 * has to adapt (the key handlers themselves already accept metaKey || ctrlKey).
 *
 * SSR-safe via useSyncExternalStore (same pattern as useIsMobile): the server
 * snapshot is always `false` (non-Mac), so the server HTML and the first client
 * render agree — no hydration mismatch. Immediately after hydration React re-reads
 * the client snapshot and flips Mac users to `true`. Platform can't change at
 * runtime, so `subscribe` is a no-op.
 */
function detectMac(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform || nav.platform || nav.userAgent || "";
  return /mac/i.test(platform);
}

const subscribe = () => () => {};
const getServerSnapshot = () => false;

export function useIsMac(): boolean {
  return useSyncExternalStore(subscribe, detectMac, getServerSnapshot);
}

/**
 * formatShortcut — rewrite a Mac shortcut glyph for the current platform: "⌘K"
 * becomes "Ctrl K" off Mac, and is left unchanged on Mac. It operates on prose
 * too, so the SAME call platform-corrects both a bare <kbd> hint ("⌘K") and a
 * sentence that embeds one ("Press ⌘K to jump to any city…").
 */
export function formatShortcut(text: string, isMac: boolean): string {
  if (isMac) return text;
  return text.replace(/⌘\s*([A-Za-z])/g, "Ctrl $1").replace(/⌘/g, "Ctrl");
}

export default useIsMac;
