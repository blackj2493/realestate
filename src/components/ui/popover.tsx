"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

interface PopoverProps {
  trigger: React.ReactNode | ((open: boolean) => React.ReactNode);
  children: React.ReactNode | ((close: () => void) => React.ReactNode);
  className?: string;
  align?: "left" | "right";
}

interface AnchorRect {
  top: number;
  left: number;
  right: number;
}

/**
 * Lightweight popover. The panel is portaled to <body> with fixed positioning
 * anchored to the trigger, so it escapes any `overflow` clip or stacking context
 * of its container (e.g. the horizontally-scrollable filter bar). Toggles on
 * trigger click; closes on outside-click or Escape.
 */
export function Popover({ trigger, children, className, align = "left" }: PopoverProps) {
  const [open, setOpen] = React.useState(false);
  const [anchor, setAnchor] = React.useState<AnchorRect | null>(null);
  const triggerRef = React.useRef<HTMLDivElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);

  const reposition = React.useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setAnchor({ top: r.bottom + 4, left: r.left, right: window.innerWidth - r.right });
  }, []);

  const onTriggerClick = () => {
    if (!open) reposition();
    setOpen((o) => !o);
  };

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
      <div onClick={onTriggerClick}>{typeof trigger === "function" ? trigger(open) : trigger}</div>
      {open &&
        anchor &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={panelRef}
            style={{
              position: "fixed",
              top: anchor.top,
              ...(align === "right" ? { right: anchor.right } : { left: anchor.left }),
            }}
            className={cn(
              "z-[100] border border-slate-700 bg-slate-900 p-3 shadow-xl",
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
