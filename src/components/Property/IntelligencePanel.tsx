"use client";

/**
 * "PureProperty Intelligence" panel (mobile) — bento tile layout.
 *
 * A synthesised `verdict` leads, then every insight is a TILE showing its headline
 * answer, so the whole set fits one screen with no scroll. Tapping a tile opens a
 * bottom SHEET with the full analysis (comps, grade breakdown, reno moves, cost
 * model) — the card→sheet progressive-disclosure pattern. Tiles arrive from page.tsx
 * with their VOW gating already applied; a `locked` tile shows a "Sign in" state and
 * never a real number, and the sheet renders the locked card's own teaser.
 *
 * The sheet is portaled to <body> so no transformed/sticky ancestor can trap it, and
 * it mounts a tile's `detail` only while open (collapsed panel stays cheap).
 */

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X, Lock, Maximize2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface IntelligenceTile {
  key: string;
  label: string;
  icon?: ReactNode;
  /** The tile's headline content — a value, grade pill, or short text. Ignored when `locked`. */
  value?: ReactNode;
  /** One short line under the value. Hidden when `locked`. */
  sub?: ReactNode;
  /** Full analysis, shown in the bottom sheet on tap. */
  detail: ReactNode;
  /** Full-width tile (spans both columns). */
  wide?: boolean;
  /** VOW gate — show a sign-in state instead of the value; the sheet still shows the locked card. */
  locked?: boolean;
  /** Sheet header title (defaults to `label`). */
  sheetTitle?: string;
}

export default function IntelligencePanel({
  verdict,
  tiles,
  footer,
}: {
  /** One-line synthesis + headline chips, rendered above the tiles. */
  verdict?: ReactNode;
  tiles: IntelligenceTile[];
  /** Rendered below the grid — the single sign-in gate strip for anon. */
  footer?: ReactNode;
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const openTile = tiles.find((t) => t.key === openKey) ?? null;

  // Close on Escape + lock body scroll while the sheet is open.
  useEffect(() => {
    if (!openTile) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenKey(null);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [openTile]);

  return (
    <div className="rounded-lg border border-cyan-500/40 bg-cyan-50 dark:border-cyan-500/30 dark:bg-card/50" data-tour="listing-intelligence">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <span className="h-2 w-2 rounded-full bg-cyan-400" aria-hidden />
        <h3 className="font-mono text-xs font-bold uppercase tracking-widest text-foreground">
          PureProperty Intelligence
        </h3>
      </div>

      <div className="space-y-3 p-3">
        {verdict != null && verdict}

        <div className="grid grid-cols-2 gap-2.5">
          {tiles.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setOpenKey(t.key)}
              aria-haspopup="dialog"
              className={cn(
                "relative flex min-h-[98px] flex-col rounded-xl border border-border bg-card p-3 text-left transition-colors hover:border-cyan-500/40 hover:bg-cyan-500/[0.04] focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60",
                t.wide && "col-span-2"
              )}
            >
              <span className="flex items-center gap-2 text-muted-foreground">
                {t.icon != null && (
                  <span className="text-cyan-700 dark:text-cyan-400" aria-hidden>
                    {t.icon}
                  </span>
                )}
                <span className="text-[11px] font-semibold">{t.label}</span>
              </span>

              {/* Subtle "opens a detail" affordance — the whole tile is the tap target. */}
              <Maximize2 className="absolute right-2.5 top-2.5 h-3 w-3 text-muted-foreground/40" aria-hidden />

              <span className="mt-2 flex flex-1 flex-col justify-center">
                {t.locked ? (
                  <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-muted-foreground">
                    <Lock className="h-4 w-4" aria-hidden /> Sign in to see
                  </span>
                ) : (
                  t.value
                )}
              </span>

              {!t.locked && t.sub != null && (
                <span className="mt-1.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">{t.sub}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {footer && <div className="border-t border-border p-4">{footer}</div>}

      {openTile != null &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-[80] flex flex-col justify-end"
            role="dialog"
            aria-modal="true"
            aria-label={openTile.sheetTitle ?? openTile.label}
          >
            {/* Scrim — tap to dismiss. */}
            <button
              type="button"
              aria-label="Close"
              onClick={() => setOpenKey(null)}
              className="absolute inset-0 bg-black/60"
            />
            <div className="relative max-h-[86vh] overflow-y-auto rounded-t-2xl border-t border-cyan-500/30 bg-background px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 shadow-2xl">
              {/* Sticky header: drag handle + title + explicit close (obvious dismissal). */}
              <div className="sticky top-0 z-10 -mx-4 mb-2 border-b border-border bg-background/95 px-4 pb-2 pt-1 backdrop-blur">
                <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-muted-foreground/30" aria-hidden />
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-sm font-bold text-foreground">
                    {openTile.icon != null && (
                      <span className="text-cyan-700 dark:text-cyan-400" aria-hidden>
                        {openTile.icon}
                      </span>
                    )}
                    {openTile.sheetTitle ?? openTile.label}
                  </span>
                  <button
                    type="button"
                    onClick={() => setOpenKey(null)}
                    aria-label="Close"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="pt-1">{openTile.detail}</div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
