/**
 * MapTimeline — the temporal scrubber (Temporal Distress Engine, visualized).
 * Sweeps a True-DOM window across the loaded listings so you can watch where
 * fresh vs. stale inventory clusters. Client-side (AlphaMap filters by the
 * window) so playback is smooth. Pair with Color = True DOM for the full effect.
 */

"use client";

import React, { useEffect } from "react";
import { Play, Pause, X } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";

const HALF = 22; // must match AlphaMap's DOM_WINDOW_HALF
const MAX_DOM = 365;
const MIN_DOM = 10; // smallest window-center that keeps the low-DOM band visible

export default function MapTimeline() {
  const timelineActive = useCommandCenterStore((s) => s.timelineActive);
  const setTimelineActive = useCommandCenterStore((s) => s.setTimelineActive);
  const domCenter = useCommandCenterStore((s) => s.domCenter);
  const setDomCenter = useCommandCenterStore((s) => s.setDomCenter);
  const playing = useCommandCenterStore((s) => s.timelinePlaying);
  const setPlaying = useCommandCenterStore((s) => s.setTimelinePlaying);

  // Sweep the window while playing; read live state so the interval never goes stale.
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      const cur = useCommandCenterStore.getState().domCenter;
      setDomCenter(cur + 10 > MAX_DOM ? MIN_DOM : cur + 10);
    }, 450);
    return () => clearInterval(id);
  }, [playing, setDomCenter]);

  if (!timelineActive) return null;

  const lo = Math.max(0, domCenter - HALF);
  const hi = Math.min(MAX_DOM, domCenter + HALF);

  return (
    <div className="absolute bottom-16 left-1/2 z-10 hidden w-[28rem] max-w-[80vw] -translate-x-1/2 border border-border bg-card/90 px-3 py-2.5 backdrop-blur-md md:block">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Days on market
        </span>
        <span className="font-mono text-xs text-cyan-700 dark:text-cyan-300">
          {lo}–{hi} days
        </span>
        <button
          type="button"
          onClick={() => {
            setPlaying(false);
            setTimelineActive(false);
          }}
          aria-label="Close timeline"
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setPlaying(!playing)}
          aria-label={playing ? "Pause" : "Play"}
          className="flex h-7 w-7 shrink-0 items-center justify-center border border-cyan-500/50 bg-cyan-500/15 text-cyan-200 hover:bg-cyan-500/25"
        >
          {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        </button>
        <Slider
          value={[domCenter]}
          onValueChange={([v]) => setDomCenter(v)}
          min={0}
          max={MAX_DOM}
          step={5}
          className="flex-1"
        />
      </div>
    </div>
  );
}
