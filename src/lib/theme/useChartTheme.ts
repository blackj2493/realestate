"use client";

import { useTheme } from "next-themes";

/**
 * Theme-aware colours for JS-driven charts (recharts et al.) where CSS variables in
 * SVG presentation attributes don't resolve. Neutral chrome (grid / axis / surface)
 * flips with the theme; semantic series colours are stable and stay legible on both
 * light and dark plot surfaces. Hand-rolled SSR SVGs should instead use inline
 * `style={{ stroke: "hsl(var(--border))" }}` so they don't need this client hook.
 */
export function useChartTheme() {
  const { resolvedTheme } = useTheme();
  const light = resolvedTheme === "light";
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
