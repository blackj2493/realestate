"use client";

import { useTheme } from "next-themes";
import { useHydrated } from "@/lib/theme/useHydrated";

/**
 * Theme-aware colours for JS-driven charts (recharts et al.) where CSS variables in
 * SVG presentation attributes don't resolve. Neutral chrome (grid / axis / surface)
 * flips with the theme; semantic series colours are stable and stay legible on both
 * light and dark plot surfaces. Hand-rolled SSR SVGs should instead use inline
 * `style={{ stroke: "hsl(var(--border))" }}` so they don't need this client hook.
 *
 * HYDRATION: because these land in SVG presentation ATTRIBUTES, a theme mismatch is an
 * attribute mismatch — and React does not patch those. So pre-mount we must hand back the
 * palette the SERVER produced, then correct once mounted. `resolvedTheme` lives in
 * localStorage and is undefined until next-themes mounts, so the server's palette is
 * always the app DEFAULT — never whatever this visitor last chose.
 */
export function useChartTheme() {
  const { resolvedTheme } = useTheme();
  // That default is now LIGHT (defaultTheme:"light", and the root <html> no longer ships a
  // `dark` class), so the pre-mount fallback has to be light too. The old
  // `hydrated && resolvedTheme === "light"` fell back to DARK, which was right only while
  // dark was the default — flipping the default inverted it, and every chart painted its
  // navy/cyan dark palette onto the pale SSR page until hydration corrected it (and stayed
  // there for good without JS). Post-mount, anything that isn't "dark" is light.
  const hydrated = useHydrated();
  const light = hydrated ? resolvedTheme !== "dark" : true;
  return {
    grid: light ? "#e2e8f0" : "#1e293b", // slate-200 / slate-800
    axisLine: light ? "#cbd5e1" : "#334155", // slate-300 / slate-700
    axisText: light ? "#475569" : "#64748b", // slate-600 / slate-500 — legible on the surface
    surface: light ? "#ffffff" : "#0b1220", // dot stroke / plot background
    tooltipBg: light ? "#ffffff" : "#0f172a",
    tooltipBorder: light ? "#e2e8f0" : "#334155",
    // Daylight chart palette (light): steel-blue sold-volume bars under a navy-ink
    // trend line, with a teal "live" endpoint — the mockup's instrument look.
    bar: light ? "#4f79a6" : "#1e3a4a", // steel blue / navy
    barAccent: light ? "#6b93bf" : "#155e75", // secondary bars
    line: light ? "#0a1828" : "#22d3ee", // navy ink / cyan-400
    endpoint: light ? "#0b8fa0" : "#22d3ee", // teal signal dot on the latest point
  };
}
