/**
 * MapDrawer — the single slide-out panel for the Instrument Deck rail.
 *
 * Only one drawer is open at a time (store.activeModule) so the map is never
 * buried. Content switches on the active module; later phases register more
 * panels in renderContent(). Mounts/unmounts with an enter+exit slide so the
 * surface feels alive. Overflow is intentionally visible — the housed filter
 * components open their own autocomplete popovers to the right.
 */

"use client";

import React, { useEffect, useState } from "react";
import { X, Layers, Palette, PenTool, GitCompareArrows, Bookmark, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCommandCenterStore, type RailModule } from "@/lib/stores/commandCenterStore";
import CommuteFilter from "./CommuteFilter";
import SchoolFilter from "./SchoolFilter";
import MapColorPanel from "./MapColorPanel";
import MapDrawPanel from "./MapDrawPanel";
import MapComparePanel from "./MapComparePanel";
import MapLensesPanel from "./MapLensesPanel";

const TITLES: Record<RailModule, string> = {
  layers: "Data Layers",
  color: "Color By",
  draw: "Draw Area",
  compare: "Compare",
  time: "Timeline",
  lenses: "Lenses",
};

const ICONS: Record<RailModule, LucideIcon> = {
  layers: Layers,
  color: Palette,
  draw: PenTool,
  compare: GitCompareArrows,
  time: Layers,
  lenses: Bookmark,
};

function DrawerHeader({ module, onClose }: { module: RailModule; onClose: () => void }) {
  const Icon = ICONS[module];
  return (
    <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2.5">
      <span className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-cyan-400" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-300">
          {TITLES[module]}
        </span>
      </span>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close panel"
        className="text-slate-500 transition-colors hover:text-slate-200"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function renderContent(module: RailModule) {
  switch (module) {
    case "layers":
      return (
        <div className="flex flex-col gap-2 p-3">
          <p className="px-0.5 text-[10px] font-medium uppercase tracking-wider text-slate-500">
            Data Overlays
          </p>
          <CommuteFilter />
          <SchoolFilter />
        </div>
      );
    case "color":
      return <MapColorPanel />;
    case "draw":
      return <MapDrawPanel />;
    case "compare":
      return <MapComparePanel />;
    case "lenses":
      return <MapLensesPanel />;
    default:
      return null;
  }
}

export default function MapDrawer() {
  const activeModule = useCommandCenterStore((s) => s.activeModule);
  const setActiveModule = useCommandCenterStore((s) => s.setActiveModule);

  // Render-gate so the panel can play an exit animation before unmounting.
  const [rendered, setRendered] = useState<RailModule | null>(activeModule);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (activeModule) {
      setRendered(activeModule);
      const id = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(id);
    }
    setShown(false);
    const t = setTimeout(() => setRendered(null), 200);
    return () => clearTimeout(t);
  }, [activeModule]);

  if (!rendered) return null;
  const content = renderContent(rendered);
  if (!content) return null;

  return (
    <div
      className={cn(
        "absolute left-14 top-0 z-20 w-72 border-r border-slate-800 bg-slate-950/95 backdrop-blur-md transition-all duration-200",
        shown ? "translate-x-0 opacity-100" : "-translate-x-3 opacity-0"
      )}
    >
      <DrawerHeader module={rendered} onClose={() => setActiveModule(null)} />
      {content}
    </div>
  );
}
