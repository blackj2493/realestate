"use client";

import { Download } from "lucide-react";
import { useInstallPrompt, useMenuInstallMode } from "@/lib/pwa/useInstallPrompt";

interface InstallAppRowProps {
  /** Called first on tap — the drawer closes itself before the prompt/sheet appears. */
  onAction?: () => void;
}

/**
 * "Install app" row for the mobile navigation drawer — the one place a user goes
 * looking for it, as opposed to the nudge that comes looking for them. Shows in every
 * iPhone/iPad and Android browser tab (menuInstallMode): Chrome's dialog when Chrome
 * offers it, else the how-to sheet. Hidden when running from the home screen.
 */
export default function InstallAppRow({ onAction }: InstallAppRowProps) {
  const mode = useMenuInstallMode();
  const promptInstall = useInstallPrompt((s) => s.promptInstall);
  const openStepsSheet = useInstallPrompt((s) => s.openStepsSheet);

  if (mode === null) return null;

  return (
    <button
      type="button"
      onClick={() => {
        onAction?.();
        if (mode === "ios-steps") openStepsSheet("ios", "menu");
        else if (mode === "android-steps") openStepsSheet("android", "menu");
        else
          void promptInstall("menu").then((r) => {
            // The held event can go stale; show the steps rather than do nothing.
            if (r === "unavailable" && /Android/i.test(navigator.userAgent)) openStepsSheet("android", "menu");
          });
      }}
      // Mirrors the nav link rows above it (MobileNav.tsx) so it reads as one list.
      className="terminal-font flex w-full items-center gap-3 border-l-2 border-transparent px-4 py-3 text-left text-[12px] uppercase tracking-[0.2em] text-foreground transition-colors hover:bg-card hover:text-cyan-700 dark:hover:text-cyan-400"
    >
      <Download className="h-4 w-4 shrink-0" />
      Install app
    </button>
  );
}
