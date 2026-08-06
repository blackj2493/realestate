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
    // bg-slate-950, not bg-background: the Mapbox style is `dark-v11` and the
    // scrim is slate-950, so this hero is a permanently-dark surface in BOTH
    // themes. bg-background flipped to the light ground in light mode — most
    // visibly on phones, where the map is skipped entirely. slate-950 is the
    // exact value of --background in dark (229 84% 5%), so dark is unchanged.
    <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden bg-slate-950">
      {/* Faint texture shown only until the map tiles load */}
      <div className="grid-pattern absolute inset-0 opacity-20" />

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
