"use client";

import { useEffect } from "react";
import { useToast } from "@/components/ui/use-toast";
import { useInstallPrompt } from "@/lib/pwa/useInstallPrompt";

/**
 * Closes the loop on a native install. Chrome's dialog disappears the moment the user
 * taps "Install", but on Android the home-screen icon (a WebAPK) can take several seconds
 * to appear, and nothing on the page said anything — the user had to leave and check the
 * phone. So: "Adding…" while the install runs, then a confirmation when `appinstalled`
 * fires. iOS never reaches this (no install API; the how-to sheet is the whole flow).
 * Renders nothing.
 */
export default function InstallConfirmation() {
  const { toast } = useToast();
  const stage = useInstallPrompt((s) => s.installStage);

  useEffect(() => {
    if (stage === "idle") return;
    // Phones get "home screen"; desktop Chrome/Edge open the app in its own window.
    const phone = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (stage === "installing") {
      toast({
        title: phone ? "Adding PureProperty to your home screen…" : "Installing PureProperty…",
        duration: 20_000,
      });
      return;
    }
    // TOAST_LIMIT is 1, so this replaces the "Adding…" toast in place.
    toast({
      title: phone ? "PureProperty is on your home screen" : "PureProperty is installed",
      description: phone
        ? "Open it from the icon for the full-screen version."
        : "It opens in its own window from now on.",
      duration: 10_000,
    });
  }, [stage, toast]);

  return null;
}
