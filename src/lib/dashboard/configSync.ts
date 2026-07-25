"use client";

/**
 * Cross-device sync for the dashboard config (migration 096).
 *
 * The dashboard stays localStorage-FIRST (instant paint, works signed-out);
 * this module mirrors it to /api/dashboard-config for signed-in users:
 *  - fetchServerConfig(): one-shot load on dashboard mount. Server wins when a
 *    row exists; `null` config = signed-in but never synced (seed it);
 *    `signedOut`/network failure = stay local-only, exactly the old behaviour.
 *  - pushConfig(): debounced fire-and-forget PUT (last-writer-wins). A 401
 *    (signed-out tab) is silently ignored.
 */
import type { DashboardConfig } from "./config";

export interface ServerConfigResult {
  /** Normalizable blob when the user has a synced row; null when none yet. */
  config: unknown | null;
  /** True when the request failed or the session is missing — do not seed. */
  unavailable: boolean;
}

export async function fetchServerConfig(): Promise<ServerConfigResult> {
  try {
    const res = await fetch("/api/dashboard-config", { cache: "no-store" });
    if (!res.ok) return { config: null, unavailable: true };
    const data = (await res.json()) as { config?: unknown };
    return { config: data.config ?? null, unavailable: false };
  } catch {
    return { config: null, unavailable: true };
  }
}

const PUSH_DEBOUNCE_MS = 800;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pending: DashboardConfig | null = null;

/** Debounced mirror-to-server; safe to call on every local save. */
export function pushConfig(config: DashboardConfig): void {
  pending = config;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    const body = pending;
    pushTimer = null;
    pending = null;
    if (!body) return;
    void fetch("/api/dashboard-config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: body }),
    }).catch(() => {
      /* offline / signed-out — localStorage still has it; next visit re-syncs */
    });
  }, PUSH_DEBOUNCE_MS);
}
