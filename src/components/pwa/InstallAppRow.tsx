"use client";

import { Download } from "lucide-react";
import { useInstallPrompt, useInstallPlatform } from "@/lib/pwa/useInstallPrompt";

interface InstallAppRowProps {
  /** Called first on tap — the drawer closes itself before the prompt/sheet appears. */
  onAction?: () => void;
}

/**
 * "Install app" row for the mobile navigation drawer — the one place a user goes
 * looking for it, as opposed to the nudge that comes looking for them. Renders only
 * where an install is possible right now, and never once installed.
 */
export default function InstallAppRow({ onAction }: InstallAppRowProps) {
  const platform = useInstallPlatform();
  const promptInstall = useInstallPrompt((s) => s.promptInstall);
  const openIosSheet = useInstallPrompt((s) => s.openIosSheet);

  if (platform === "installed" || platform === "unsupported") return null;

  return (
    <button
      type="button"
      onClick={() => {
        onAction?.();
        if (platform === "ios") openIosSheet("menu");
        else void promptInstall("menu");
      }}
      // Mirrors the nav link rows above it (MobileNav.tsx) so it reads as one list.
      className="terminal-font flex w-full items-center gap-3 border-l-2 border-transparent px-4 py-3 text-left text-[12px] uppercase tracking-[0.2em] text-foreground transition-colors hover:bg-card hover:text-cyan-700 dark:hover:text-cyan-400"
    >
      <Download className="h-4 w-4 shrink-0" />
      Install app
    </button>
  );
}
