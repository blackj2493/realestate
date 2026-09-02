"use client";

/**
 * Cross-device sync for the dashboard config (migration 096).
 *
 * The dashboard stays localStorage-FIRST (instant paint, works signed-out);
 * this module mirrors it to /api/dashboard-config for signed-in users:
 *  - fetchServerConfig(): one-shot load on dashboard mount. Server wins when a
 *    row exists; `null` config = signed-in but never synced (seed it);
 *    `signedOut`/network failure = stay local-only, exactly the old behaviour.
 *  - pushConfig(): debounced PUT carrying the `updated_at` this device's copy is
 *    based on. A 401 (signed-out tab) is silently ignored.
 *
 * WHY THE BASELINE. The config is one jsonb blob and the PUT writes it whole, so under
 * last-writer-wins a device holding a stale copy overwrote a newer one — and since
 * `fetchServerConfig` reports `unavailable` on ANY failed GET, a single network blip was
 * enough to leave a device stale for the rest of the session. Its next edit, even just a
 * lens tweak, then deleted every area added on another device. The server now refuses a
 * write based on an older `updated_at` (409) and returns the current copy; we adopt it
 * and tell the caller, rather than push again — a retry loop is how you turn a lost edit
 * into a fight between two tabs.
 */
import type { DashboardConfig } from "./config";

export interface ServerConfigResult {
  /** Normalizable blob when the user has a synced row; null when none yet. */
  config: unknown | null;
  /** Row version to base the next write on; null when there is no row. */
  updatedAt: string | null;
  /** True when the request failed or the session is missing — do not seed. */
  unavailable: boolean;
}

/**
 * The `updated_at` our in-memory copy is based on. `null` means "no row yet", which the
 * server checks too — so a device that thought it was seeding a fresh account cannot
 * overwrite one that another device seeded first.
 */
let baseUpdatedAt: string | null = null;

/** Adopt a server version as the baseline for subsequent writes. */
export function setConfigBaseline(updatedAt: string | null): void {
  baseUpdatedAt = updatedAt;
}

export async function fetchServerConfig(): Promise<ServerConfigResult> {
  try {
    const res = await fetch("/api/dashboard-config", { cache: "no-store" });
    if (!res.ok) return { config: null, updatedAt: null, unavailable: true };
    const data = (await res.json()) as { config?: unknown; updated_at?: string | null };
    const updatedAt = data.updated_at ?? null;
    setConfigBaseline(updatedAt);
    return { config: data.config ?? null, updatedAt, unavailable: false };
  } catch {
    return { config: null, updatedAt: null, unavailable: true };
  }
}

const PUSH_DEBOUNCE_MS = 800;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pending: DashboardConfig | null = null;

export interface PushHandlers {
  /**
   * The server refused the write because another device had already moved on. The
   * argument is the server's current blob (un-normalized); adopt it. Do NOT push from
   * here — the baseline has already been advanced to the server's version.
   */
  onServerNewer?: (config: unknown) => void;
}

let handlers: PushHandlers = {};

/** Debounced mirror-to-server; safe to call on every local save. */
export function pushConfig(config: DashboardConfig, opts?: PushHandlers): void {
  pending = config;
  if (opts) handlers = opts;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    const body = pending;
    pushTimer = null;
    pending = null;
    if (!body) return;
    void fetch("/api/dashboard-config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: body, baseUpdatedAt }),
    })
      .then(async (res) => {
        if (res.status === 409) {
          const data = (await res.json().catch(() => ({}))) as {
            config?: unknown;
            updated_at?: string | null;
          };
          setConfigBaseline(data.updated_at ?? null);
          if (data.config) handlers.onServerNewer?.(data.config);
          return;
        }
        if (!res.ok) return; // 401 signed-out tab, 5xx — next visit re-syncs
        const data = (await res.json().catch(() => ({}))) as { updated_at?: string | null };
        if (data.updated_at) setConfigBaseline(data.updated_at);
      })
      .catch(() => {
        /* offline / signed-out — localStorage still has it; next visit re-syncs */
      });
  }, PUSH_DEBOUNCE_MS);
}
