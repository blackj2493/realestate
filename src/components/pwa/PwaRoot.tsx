"use client";

import { useEffect } from "react";
import ServiceWorkerRegister from "@/components/pwa/ServiceWorkerRegister";
import InstallNudge from "@/components/pwa/InstallNudge";
import IosInstallSheet from "@/components/pwa/IosInstallSheet";
import InstallConfirmation from "@/components/pwa/InstallConfirmation";
import { useInstallPrompt } from "@/lib/pwa/useInstallPrompt";

/**
 * PwaRoot — the single client entry-point for the installable-app layer, mounted once
 * in the root layout next to DiscoveryRoot. Hydrates the install store, registers the
 * service worker, and hosts the install nudge, the iOS how-to sheet and the install
 * confirmation toast.
 */
export default function PwaRoot() {
  const hydrate = useInstallPrompt((s) => s.hydrate);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  return (
    <>
      <ServiceWorkerRegister />
      <InstallNudge />
      <IosInstallSheet />
      <InstallConfirmation />
    </>
  );
}
