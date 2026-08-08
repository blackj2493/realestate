"use client";

import dynamic from "next/dynamic";
import { useTheme } from "next-themes";
import { useIsMobile } from "@/hooks/useIsMobile";

const HeroMapCanvas = dynamic(() => import("./HeroMapCanvas"), { ssr: false });

const SCRIM_DARK = {
  form: "radial-gradient(115% 95% at 50% 35%, rgba(2,6,23,0.32) 0%, rgba(2,6,23,0.6) 100%)",
  hero: "radial-gradient(115% 95% at 50% 40%, rgba(2,6,23,0.06) 0%, rgba(2,6,23,0.5) 100%)",
} as const;

const SCRIM_LIGHT = {
  form: "radial-gradient(115% 95% at 50% 35%, rgba(233,237,244,0.20) 0%, rgba(233,237,244,0.80) 100%)",
  hero: "radial-gradient(115% 95% at 50% 40%, rgba(233,237,244,0) 0%, rgba(233,237,244,0.62) 100%)",
} as const;

export default function HeroBackground({
  variant = "hero",
  forceDark = false,
}: {
  variant?: "hero" | "form";
  /** For pages pinned to the terminal look in BOTH themes (/apply). A `dark` CLASS
   *  can't reach the Mapbox style below, which is a JS prop, so those pages say so. */
  forceDark?: boolean;
}) {
  // Phones get the lightweight grid + emerald wash only. The Mapbox/deck.gl
  // canvas (~300-400KB JS + map tiles) is desktop-only so cellular first paint
  // stays cheap. SSR snapshot is `false` (desktop-first), matching prior markup.
  const isMobile = useIsMobile();
  const { resolvedTheme } = useTheme();

  // The basemap is ALWAYS mapbox dark-v11 — deliberately unchanged. So it may only be shown
  // where the ground is genuinely dark: rendering it under a light surface would put dark
  // type over a dark map with only a pale scrim between them, which is the same
  // illegibility the light migration exists to remove. Light surfaces fall back to the
  // CSS-only background (grid + emerald wash + scrim), exactly what /login already uses.
  //
  // `resolvedTheme` is undefined until next-themes mounts, so "not yet known" must NOT
  // collapse into "show the map" — that would flash a dark basemap onto a light page before
  // correcting. Waiting for a definite answer costs a beat of plain background on a purely
  // decorative layer. forceDark pages know their answer immediately and never wait.
  const isDark = forceDark || resolvedTheme === "dark";
  const themeKnown = forceDark || resolvedTheme !== undefined;
  const showMap = themeKnown && isDark;

  return (
    <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden bg-background">
      {/* Faint texture shown only until the map tiles load */}
      <div className="grid-pattern absolute inset-0 opacity-20" />

      {/* Live deck.gl + Mapbox dark map — desktop only (skipped on phones), and dark
          surfaces only (see showMap). */}
      {!isMobile && showMap && <HeroMapCanvas />}

      {/* Subtle emerald top wash */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(80% 50% at 50% 0%, rgba(16,185,129,0.10) 0%, transparent 60%)",
        }}
      />

      {/* Vignette + legibility scrim. Both are rendered and CSS picks one, rather than JS
          choosing: correct on the very first paint with no mounted-yet gap, and it follows
          a pinned `dark` class on an ancestor, which a `resolvedTheme` read cannot see.
          A NAVY vignette darkens the dark basemap (the original look); over the light
          basemap that same navy glooms the corners, so light fades to the pale Daylight
          ground instead and keeps the navy hero text crisp. */}
      <div
        className={forceDark ? "absolute inset-0" : "absolute inset-0 dark:hidden"}
        style={{ background: forceDark ? SCRIM_DARK[variant] : SCRIM_LIGHT[variant] }}
      />
      {!forceDark && (
        <div
          className="absolute inset-0 hidden dark:block"
          style={{ background: SCRIM_DARK[variant] }}
        />
      )}
    </div>
  );
}
