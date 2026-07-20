"use client";

import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { useHydrated } from "@/lib/theme/useHydrated";

/**
 * Light/dark toggle. Uses `resolvedTheme` so it works whether the current choice is
 * explicit light/dark or "system".
 *
 * HYDRATION: the server cannot know the resolved theme (it lives in localStorage), so every
 * theme-dependent output must agree with the server on the FIRST client render. `isDark`
 * therefore folds in `mounted` — an earlier version guarded only the icon and left
 * aria-label/title unguarded, which React reported as a mismatch and, because it does not
 * patch attributes, left dark-mode users with a button labelled "Switch to dark mode".
 * Derive every theme-dependent value from this one guarded flag.
 */
export function ThemeToggle({ className, showLabel = false }: { className?: string; showLabel?: boolean }) {
  const { resolvedTheme, setTheme } = useTheme();
  const hydrated = useHydrated();

  // Pre-hydration this is false, matching the server (where resolvedTheme is undefined).
  const isDark = hydrated && resolvedTheme === "dark";
  const label = isDark ? "Switch to light mode" : "Switch to dark mode";
  const action = isDark ? "Light mode" : "Dark mode";

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      // Safe pre-mount: React attaches handlers at hydration, by which point mounted is true.
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className={
        className ??
        "inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card text-foreground transition-colors hover:bg-muted"
      }
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      {showLabel && hydrated && <span className="text-xs font-medium">{action}</span>}
    </button>
  );
}
