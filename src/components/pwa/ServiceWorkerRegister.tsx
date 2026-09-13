"use client";

import { useEffect } from "react";
import { registerProperties, track } from "@/lib/analytics/posthog";
import { isStandaloneDisplay } from "@/lib/pwa/useInstallPrompt";

/**
 * Registers /sw.js in production. Renders nothing, and never interrupts the user.
 *
 * There used to be a "PureProperty has an update — Reload" toast here, because the worker
 * queued behind the old one until every tab closed. It was noise: sw.js caches no HTML and
 * only content-hashed /_next/static/*, so an old worker cannot serve a stale page, a stale
 * price or stale JS — a new build's HTML asks for filenames the old cache has never seen.
 * The prompt bought nothing but an earlier cache cleanup, re-appeared on EVERY page load
 * while the worker sat waiting, and landed on top of the listing-page CTAs. The worker now
 * calls skipWaiting on install and swaps in silently.
 *
 * The old comment worried that an automatic swap would reload a page mid-underwriting.
 * It cannot: skipWaiting only promotes the worker. Nothing here reloads anything.
 *
 * Dev never registers (Turbopack HMR and a caching worker fight) and actively removes
 * any worker left behind by a local `next start`, so localhost can't go stale.
 */
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const sw = navigator.serviceWorker;

    if (process.env.NODE_ENV !== "production") {
      void sw.getRegistrations().then((regs) => regs.forEach((r) => void r.unregister()));
      return;
    }

    // Every event from this browser carries how the app is running, so PostHog can
    // split installed-app sessions from browser sessions.
    registerProperties({ pp_display_mode: isStandaloneDisplay() ? "standalone" : "browser" });

    const version = process.env.NEXT_PUBLIC_BUILD_ID || "dev";

    // A new worker taking control IS the update landing — the same moment the toast's
    // "Reload" click used to report, minus the interruption. `controllerchange` also fires
    // on the very first install (clients.claim); no controller yet means this page has
    // never had one, which is an install, not an update, so the listener stays off.
    const onControllerChange = () => track("pwa_update_applied", { version });
    if (sw.controller) sw.addEventListener("controllerchange", onControllerChange);

    void sw.register(`/sw.js?v=${encodeURIComponent(version)}`, { scope: "/" }).catch(() => {
      /* registration is best-effort; the site works without it */
    });

    return () => sw.removeEventListener("controllerchange", onControllerChange);
  }, []);

  return null;
}
