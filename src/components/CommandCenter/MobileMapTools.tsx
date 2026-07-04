/**
 * MobileMapTools — the phone (<md) entry point to the map's Instrument Deck.
 *
 * On desktop the rail (MapControlRail) + drawer (MapDrawer) live on the left edge
 * of the map. Those are md-only, so on phones this is how you reach Schools,
 * Compare, Commute, Walkable, Color By, Draw Area and Saved Views: a "Tools"
 * button on the map opens a bottom sheet — a grid of the same tools, each opening
 * its EXACT same panel (renderModulePanel) so the behaviour can't drift from
 * desktop. Hidden at md+ (the rail takes over there).
 */

"use client";

import React from "react";
import {
  SlidersHorizontal,
  X,
  ChevronLeft,
  Navigation,
  GraduationCap,
  ShoppingCart,
  Palette,
  Lasso,
  Scale,
  Bookmark,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useCommandCenterStore, type RailModule } from "@/lib/stores/commandCenterStore";
import { renderModulePanel, TITLES } from "./MapDrawer";

const TOOLS: { module: RailModule; label: string; icon: LucideIcon }[] = [
  { module: "commute", label: "Commute", icon: Navigation },
  { module: "school", label: "Schools", icon: GraduationCap },
  { module: "amenity", label: "Walkable", icon: ShoppingCart },
  { module: "color", label: "Color By", icon: Palette },
  { module: "draw", label: "Draw Area", icon: Lasso },
  { module: "compare", label: "Compare", icon: Scale },
  { module: "lenses", label: "Saved Views", icon: Bookmark },
];

export default function MobileMapTools() {
  const [open, setOpen] = React.useState(false);
  const activeModule = useCommandCenterStore((s) => s.activeModule);
  const setActiveModule = useCommandCenterStore((s) => s.setActiveModule);

  // Data-active dots so a glance shows which lenses are already shaping the map.
  const commuteEnabled = useCommandCenterStore((s) => s.commute.enabled);
  const schoolEnabled = useCommandCenterStore((s) => s.school.enabled);
  const amenityEnabled = useCommandCenterStore((s) => s.amenity.enabled);
  const colorMetricId = useCommandCenterStore((s) => s.colorMetricId);
  const drawPolygon = useCommandCenterStore((s) => s.drawPolygon);
  const selectedCount = useCommandCenterStore((s) => s.selectedIds.size);

  const dataActive: Record<RailModule, boolean> = {
    commute: commuteEnabled,
    school: schoolEnabled,
    amenity: amenityEnabled,
    color: colorMetricId !== null,
    draw: drawPolygon !== null,
    compare: selectedCount > 0,
    lenses: false,
    time: false,
  };
  const activeCount = TOOLS.filter((t) => dataActive[t.module]).length;

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (activeModule) setActiveModule(null);
      else setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, activeModule, setActiveModule]);

  const close = () => {
    setOpen(false);
    setActiveModule(null);
  };

  return (
    <>
      {/* Launcher — bottom-left, clear of the centered List/Map toggle. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Map tools"
        className="absolute left-3 z-40 flex items-center gap-1.5 rounded-full border border-border bg-card/95 px-4 py-2 text-sm font-semibold text-foreground shadow-lg backdrop-blur active:bg-muted md:hidden"
        style={{ bottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
      >
        <SlidersHorizontal className="h-4 w-4 text-cyan-700 dark:text-cyan-400" />
        Tools
        {activeCount > 0 && (
          <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-cyan-500 px-1 text-[10px] font-bold leading-none text-slate-950">
            {activeCount}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-[70] flex flex-col justify-end md:hidden" role="dialog" aria-modal="true" aria-label="Map tools">
          <button type="button" aria-label="Close map tools" onClick={close} className="absolute inset-0 bg-background/80" />
          <div className="relative flex max-h-[85dvh] flex-col border-t border-border bg-background pb-safe">
            <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-3 pt-safe">
              {activeModule ? (
                <button
                  type="button"
                  onClick={() => setActiveModule(null)}
                  className="-ml-1 flex min-h-[44px] items-center gap-1 pr-2 text-sm font-semibold uppercase tracking-wider text-foreground"
                >
                  <ChevronLeft className="h-5 w-5 text-cyan-700 dark:text-cyan-400" />
                  {TITLES[activeModule]}
                </button>
              ) : (
                <span className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-foreground">
                  <SlidersHorizontal className="h-4 w-4 text-cyan-700 dark:text-cyan-400" />
                  Map Tools
                </span>
              )}
              <button
                type="button"
                onClick={close}
                aria-label="Close map tools"
                className="-mr-1 flex h-11 w-11 items-center justify-center text-muted-foreground hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto overscroll-contain">
              {activeModule ? (
                renderModulePanel(activeModule)
              ) : (
                <div className="grid grid-cols-3 gap-2 p-3">
                  {TOOLS.map((t) => {
                    const Icon = t.icon;
                    return (
                      <button
                        key={t.module}
                        type="button"
                        onClick={() => setActiveModule(t.module)}
                        className={cn(
                          "relative flex min-h-[76px] flex-col items-center justify-center gap-1.5 rounded-md border bg-card/50 py-3 transition-colors active:bg-muted",
                          dataActive[t.module] ? "border-cyan-500/50 text-cyan-200" : "border-border text-foreground"
                        )}
                      >
                        <Icon className={cn("h-5 w-5", dataActive[t.module] ? "text-cyan-700 dark:text-cyan-300" : "text-cyan-700 dark:text-cyan-400")} />
                        <span className="text-[10px] font-semibold uppercase tracking-wide">{t.label}</span>
                        {t.module === "compare" && selectedCount > 0 ? (
                          <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-cyan-500 px-1 text-[10px] font-bold leading-none text-slate-950">
                            {selectedCount}
                          </span>
                        ) : dataActive[t.module] ? (
                          <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-cyan-400" />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
