"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

interface PopoverProps {
  trigger: React.ReactNode;
  children: React.ReactNode | ((close: () => void) => React.ReactNode);
  className?: string;
  align?: "left" | "right";
}

interface Coords {
  top: number;
  left: number;
}

/** Gap between the trigger and the panel, and the minimum breathing room kept
 *  against every viewport edge when the panel is clamped back on-screen. */
const GAP = 4;
const MARGIN = 8;
/** Fallback panel width (matches the `w-56` most callers pass) used only for the
 *  first paint, before the mounted panel can be measured. */
const FALLBACK_WIDTH = 224;

/**
 * Lightweight popover. The panel is portaled to <body> with fixed positioning
 * anchored to the trigger, so it escapes any `overflow` clip or stacking context
 * of its container (e.g. the horizontally-scrollable filter bar, or the 360px
 * right-side filter drawer). Positioning is viewport-aware: the panel prefers the
 * requested edge but is clamped so it never spills off-screen — a chip near the
 * drawer's right edge opens its panel shifted left instead of being clipped.
 * Toggles on trigger click; closes on outside-click or Escape.
 */
export function Popover({ trigger, children, className, align = "left" }: PopoverProps) {
  const [open, setOpen] = React.useState(false);
  const [coords, setCoords] = React.useState<Coords | null>(null);
  const triggerRef = React.useRef<HTMLDivElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);

  const reposition = React.useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Use the panel's real size once it's mounted; fall back to the default width
    // for the very first paint (corrected, before paint, by the layout effect).
    const pw = panelRef.current?.offsetWidth ?? FALLBACK_WIDTH;
    const ph = panelRef.current?.offsetHeight ?? 0;

    // Horizontal: anchor to the requested edge, then clamp inside the viewport.
    let left = align === "right" ? r.right - pw : r.left;
    left = Math.min(left, vw - pw - MARGIN);
    left = Math.max(left, MARGIN);

    // Vertical: open below the trigger; flip above if it would overflow the
    // bottom and there's more room up top.
    let top = r.bottom + GAP;
    if (ph && top + ph > vh - MARGIN) {
      const above = r.top - GAP - ph;
      top = above >= MARGIN ? above : Math.max(MARGIN, vh - ph - MARGIN);
    }

    setCoords({ top, left });
  }, [align]);

  const onTriggerClick = () => {
    if (!open) reposition();
    setOpen((o) => !o);
  };

  // Re-measure once the panel is in the DOM: its real dimensions may differ from
  // the fallback, so the clamp uses true width/height. useLayoutEffect runs
  // before paint, so the corrected position never visibly flickers.
  React.useLayoutEffect(() => {
    if (open) reposition();
  }, [open, reposition]);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", reposition);
    // capture-phase: catch scrolls in any ancestor (the map/ledger panes), not just window
    window.addEventListener("scroll", reposition, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, reposition]);

  return (
    <div ref={triggerRef} className="relative shrink-0">
      <div onClick={onTriggerClick}>{trigger}</div>
      {open &&
        coords &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={panelRef}
            style={{
              position: "fixed",
              top: coords.top,
              left: coords.left,
            }}
            className={cn(
              // Theme-aware: the panel portals to <body>, so it escapes any local
              // `dark` scope (e.g. the terminal's instrument deck) and must style
              // both themes itself. Light gets the Daylight card; dark keeps the
              // original slate panel byte-identical via the dark: overrides.
              "z-[100] border border-border bg-card p-3 shadow-xl dark:border-slate-700 dark:bg-slate-900",
              className
            )}
          >
            {typeof children === "function" ? children(() => setOpen(false)) : children}
          </div>,
          document.body
        )}
    </div>
  );
}
