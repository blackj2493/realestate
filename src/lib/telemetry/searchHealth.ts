/**
 * Browser-side reporter for Typesense search failures (the terminal "Search Error /
 * timeout of 15000ms exceeded" mode). The terminal queries Typesense Cloud DIRECTLY
 * from the browser, so these failures are invisible to server logs — this beacon is
 * the only signal. Fire-and-forget: it must never throw, block, or add latency to
 * the search path, and it self-limits so a retry storm can't flood the endpoint.
 */

import { classifySearchError } from "./searchHealthPolicy";

const SESSION_KEY = "pp_sh_sid";
const LAST_SENT_KEY = "pp_sh_last";
const COUNT_KEY = "pp_sh_count";
/** At most one report per this window per tab (a wedged connection fails EVERY search). */
const MIN_INTERVAL_MS = 20_000;
/** Hard per-tab cap — after this a pathological session goes quiet. */
const MAX_PER_SESSION = 10;

function sessionId(): string {
  try {
    let id = window.sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id = crypto.randomUUID();
      window.sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return "no-storage";
  }
}

/** Report one failed listing search. Browser-only no-op elsewhere; never throws. */
export function reportSearchFailure(err: unknown, durationMs: number, context?: Record<string, unknown>): void {
  try {
    if (typeof window === "undefined") return;

    const now = Date.now();
    const last = Number(window.sessionStorage.getItem(LAST_SENT_KEY) ?? 0);
    const count = Number(window.sessionStorage.getItem(COUNT_KEY) ?? 0);
    if (now - last < MIN_INTERVAL_MS || count >= MAX_PER_SESSION) return;
    window.sessionStorage.setItem(LAST_SENT_KEY, String(now));
    window.sessionStorage.setItem(COUNT_KEY, String(count + 1));

    const message = (err instanceof Error ? err.message : String(err ?? "")).slice(0, 200);
    const body = JSON.stringify({
      kind: classifySearchError(err),
      durationMs: Math.round(durationMs),
      sessionId: sessionId(),
      context: { path: window.location.pathname, message, ...context },
    });

    // sendBeacon survives page unloads and never blocks; keepalive fetch is the fallback.
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/telemetry/search-timeout", new Blob([body], { type: "application/json" }));
    } else {
      void fetch("/api/telemetry/search-timeout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => {});
    }
  } catch {
    /* telemetry must never break the search path */
  }
}
