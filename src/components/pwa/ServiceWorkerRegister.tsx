"use client";

import { useEffect, useRef } from "react";
import { useToast } from "@/components/ui/use-toast";
import { ToastAction } from "@/components/ui/toaster";
import { registerProperties, track } from "@/lib/analytics/posthog";
import { isStandaloneDisplay } from "@/lib/pwa/useInstallPrompt";

/**
 * Registers /sw.js in production and offers a one-tap reload when a new build is
 * waiting. Renders nothing.
 *
 * Why the reload is opt-in: the worker calls skipWaiting only on request. An automatic
 * swap mid-session would reload a page the user is working in — an underwriting
 * scenario they haven't saved — so the new version waits behind a toast, and if they
 * ignore it, it takes over on the next launch.
 *
 * Dev never registers (Turbopack HMR and a caching worker fight) and actively removes
 * any worker left behind by a local `next start`, so localhost can't go stale.
 */
export default function ServiceWorkerRegister() {
  const { toast } = useToast();
  // `controllerchange` also fires on the very first install (clients.claim); only
  // reload when the user asked for the update.
  const wantReload = useRef(false);

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

    const offer = (worker: ServiceWorker) => {
      toast({
        title: "PureProperty has an update",
        description: "Reload to get the latest version.",
        duration: 60_000,
        action: (
          <ToastAction
            altText="Reload now"
            onClick={() => {
              wantReload.current = true;
              worker.postMessage({ type: "SKIP_WAITING" });
              track("pwa_update_applied", { version });
            }}
          >
            Reload
          </ToastAction>
        ),
      });
    };

    const onControllerChange = () => {
      if (!wantReload.current) return;
      wantReload.current = false;
      window.location.reload();
    };
    sw.addEventListener("controllerchange", onControllerChange);

    void sw
      .register(`/sw.js?v=${encodeURIComponent(version)}`, { scope: "/" })
      .then((reg) => {
        // Came back after a deploy with a worker already waiting.
        if (reg.waiting && sw.controller) offer(reg.waiting);
        reg.addEventListener("updatefound", () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            // `installed` with an existing controller = an update, not the first install.
            if (installing.state === "installed" && sw.controller) offer(installing);
          });
        });
      })
      .catch(() => {
        /* registration is best-effort; the site works without it */
      });

    return () => sw.removeEventListener("controllerchange", onControllerChange);
  }, [toast]);

  return null;
}
