"use client";

import dynamic from "next/dynamic";
import { useIsMobile } from "@/hooks/useIsMobile";

const HeroMapCanvas = dynamic(() => import("./HeroMapCanvas"), { ssr: false });

export default function HeroBackground({
  variant = "hero",
}: {
  variant?: "hero" | "form";
}) {
  // Phones get the lightweight grid + emerald wash only. The Mapbox/deck.gl
  // canvas (~300-400KB JS + map tiles) is desktop-only so cellular first paint
  // stays cheap. SSR snapshot is `false` (desktop-first), matching prior markup.
  const isMobile = useIsMobile();

  // Keep the map clearly visible; only enough scrim for text legibility.
  const scrim =
    variant === "form"
      ? "radial-gradient(115% 95% at 50% 35%, rgba(2,6,23,0.32) 0%, rgba(2,6,23,0.6) 100%)"
      : "radial-gradient(115% 95% at 50% 40%, rgba(2,6,23,0.06) 0%, rgba(2,6,23,0.5) 100%)";

  return (
    // The ground is PINNED dark (slate-950 === the dark `--background`, so dark mode
    // is unchanged) rather than themed `bg-background`. Everything painted on top of
    // it — the dark-v11 Mapbox style, the scrim below, and the hero/apply content —
    // is authored light-on-dark, so this surface must not flip with the theme.
    //
    // It used to be `bg-background`. On DESKTOP that was invisible because the opaque
    // map covers it, but the map is skipped on phones (see below), so in light mode the
    // ground showed through as #e9edf4 and the scrim greyed the whole page out
    // (#9fa3ad centre → #5e626f edges), washing out the white type and the wordmark.
    // Same defect #303 fixed on /login; this is the component /  and /apply use.
    <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden bg-slate-950">
      {/* Faint texture shown only until the map tiles load. Inlined rather than the
          global `.grid-pattern`, which is blanked under `:root:not(.dark)` — that rule
          exists for genuinely light grounds, and this one is never light. */}
      <div
        className="absolute inset-0 opacity-20"
        style={{
          backgroundImage:
            "linear-gradient(rgba(30,41,59,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(30,41,59,0.3) 1px, transparent 1px)",
          backgroundSize: "20px 20px",
        }}
      />

      {/* Live deck.gl + Mapbox dark map — desktop only (skipped on phones) */}
      {!isMobile && <HeroMapCanvas />}

      {/* Subtle emerald top wash */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(80% 50% at 50% 0%, rgba(16,185,129,0.10) 0%, transparent 60%)",
        }}
      />
      {/* Vignette + legibility scrim */}
      <div className="absolute inset-0" style={{ background: scrim }} />
    </div>
  );
}
