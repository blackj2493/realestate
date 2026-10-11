/**
 * MobileFilterSheet — the phone (<md) home of FilterPanel: a full-height bottom sheet.
 *
 * On a 360px canvas the desktop bar's chips scroll off-screen, so on phones the bar
 * collapses to a "Filters" button that opens this sheet. The panel inside is the same one
 * the desktop drawer renders, so the two surfaces cannot drift.
 *
 * The sheet opens nearly full height (nothing important hides below a fold) and closes by
 * dragging the handle down, tapping the backdrop, the close button, or Escape. The drag is
 * on the handle only, so scrolling the panel never fights it.
 */

"use client";

import React from "react";
import FilterPanel, { type FilterPanelProps } from "./filterPanel/FilterPanel";

export type { FilterItem } from "./filterTokens";

/** How far the handle must travel down before letting go closes the sheet. */
const CLOSE_DISTANCE = 96;

export default function MobileFilterSheet(props: Omit<FilterPanelProps, "surface" | "dragHandleProps">) {
  const { onClose } = props;
  const [drag, setDrag] = React.useState(0);
  const start = React.useRef<number | null>(null);

  const dragHandleProps: React.HTMLAttributes<HTMLDivElement> = {
    onPointerDown: (e) => {
      start.current = e.clientY;
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove: (e) => {
      if (start.current === null) return;
      setDrag(Math.max(0, e.clientY - start.current));
    },
    onPointerUp: () => {
      const moved = drag;
      start.current = null;
      setDrag(0);
      if (moved > CLOSE_DISTANCE) onClose();
    },
    onPointerCancel: () => {
      start.current = null;
      setDrag(0);
    },
  };

  return (
    <div className="fixed inset-0 z-[70] flex flex-col justify-end md:hidden" role="dialog" aria-modal="true" aria-label="Filters">
      <button
        type="button"
        aria-label="Close filters"
        onClick={onClose}
        className="absolute inset-0 bg-background/80"
      />
      <div
        className="relative h-[94dvh] overflow-hidden border-t border-border"
        style={{
          transform: drag ? `translateY(${drag}px)` : undefined,
          transition: drag ? "none" : "transform 160ms ease-out",
        }}
      >
        <FilterPanel {...props} surface="sheet" dragHandleProps={dragHandleProps} />
      </div>
    </div>
  );
}
