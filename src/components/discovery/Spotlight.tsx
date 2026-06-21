/**
 * Spotlight — the overlay that dims the page and highlights one feature, with a
 * bubble explaining it. Drives both the "Show me" action (a single step) and the
 * persona-aware first-run tours (a sequence). Reads the active run from
 * useDiscovery; renders nothing when there isn't one.
 *
 * Built on a body portal with fixed positioning (same approach as ui/popover):
 * it escapes any overflow/stacking-context, tracks the target through scroll and
 * resize, and degrades to a centred explanatory card when the target element
 * isn't on the page (e.g. an un-anchored feature, or one that lives elsewhere).
 * No animation dependency — uses the existing pp-fade-up / pp-pop keyframes.
 */

"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight, Check, ExternalLink, X } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useDiscovery } from "@/lib/discovery/useDiscovery";
import { getFeature } from "@/lib/discovery/featureRegistry";

/** Padding kept around the highlighted element, and viewport breathing room. */
const HOLE_PAD = 6;
const MARGIN = 12;
const BUBBLE_W = 320;

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** Locate the target element for a step and track its viewport box. */
function useTargetBox(selector: string | undefined, stepKey: string): Box | null {
  const [box, setBox] = React.useState<Box | null>(null);

  React.useEffect(() => {
    setBox(null);
    if (!selector) return;

    let raf = 0;
    let tries = 0;
    let el: HTMLElement | null = null;
    let scrolled = false;

    const measure = () => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      setBox({ top: r.top, left: r.left, width: r.width, height: r.height });
    };

    const tick = () => {
      el = document.querySelector<HTMLElement>(selector);
      if (el) {
        if (!scrolled) {
          scrolled = true;
          el.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
        }
        measure();
        // Keep measuring for a moment so the smooth-scroll settle is tracked.
        if (tries < 40) {
          tries += 1;
          raf = requestAnimationFrame(tick);
        }
        return;
      }
      // Element not there yet — poll briefly (it may mount late or after nav).
      if (tries < 90) {
        tries += 1;
        raf = requestAnimationFrame(tick);
      }
    };

    raf = requestAnimationFrame(tick);

    const onMove = () => measure();
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [selector, stepKey]);

  return box;
}

export default function Spotlight() {
  const run = useDiscovery((s) => s.run);
  const runNext = useDiscovery((s) => s.runNext);
  const runPrev = useDiscovery((s) => s.runPrev);
  const endRun = useDiscovery((s) => s.endRun);

  const step = run ? run.steps[run.index] : undefined;
  const feature = step ? getFeature(step) : undefined;
  const selector = feature ? feature.anchor ?? `[data-tour="${feature.id}"]` : undefined;
  const box = useTargetBox(selector, `${run?.index ?? -1}:${step ?? ""}`);

  const bubbleRef = React.useRef<HTMLDivElement>(null);
  const [bubblePos, setBubblePos] = React.useState<{ top: number; left: number } | null>(null);

  // Position the bubble: under the target if it fits, else above, else centred.
  React.useLayoutEffect(() => {
    if (!run) return;
    if (!box) {
      setBubblePos(null);
      return;
    }
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const bh = bubbleRef.current?.offsetHeight ?? 160;
    const bw = bubbleRef.current?.offsetWidth ?? BUBBLE_W;

    let left = box.left + box.width / 2 - bw / 2;
    left = Math.min(Math.max(left, MARGIN), vw - bw - MARGIN);

    const below = box.top + box.height + HOLE_PAD + 10;
    const above = box.top - HOLE_PAD - 10 - bh;
    let top: number;
    if (below + bh <= vh - MARGIN) top = below;
    else if (above >= MARGIN) top = above;
    else top = Math.max(MARGIN, vh - bh - MARGIN);

    setBubblePos({ top, left });
  }, [box, run]);

  // Keyboard: Esc skips, →/Enter advance, ← goes back.
  React.useEffect(() => {
    if (!run) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        endRun();
      } else if (e.key === "ArrowRight" || e.key === "Enter") {
        e.preventDefault();
        runNext();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        runPrev();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [run, runNext, runPrev, endRun]);

  if (!run || !feature || typeof document === "undefined") return null;

  const total = run.steps.length;
  const isLast = run.index >= total - 1;
  const Icon = feature.icon;
  const centred = !box;

  const bubble = (
    <div
      ref={bubbleRef}
      className={cn(
        "pp-fade-up pointer-events-auto z-[210] w-80 max-w-[calc(100vw-1.5rem)] border border-cyan-500/40 bg-slate-900 p-4 shadow-2xl",
        centred && "relative"
      )}
      style={
        centred
          ? undefined
          : { position: "fixed", top: bubblePos?.top ?? -9999, left: bubblePos?.left ?? -9999 }
      }
      role="dialog"
      aria-modal="true"
      aria-label={feature.title}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-7 w-7 items-center justify-center border border-cyan-500/40 bg-cyan-500/10 text-cyan-300">
            <Icon className="h-4 w-4" />
          </span>
          <p className="text-sm font-semibold text-slate-100">{feature.title}</p>
        </div>
        <button
          type="button"
          onClick={endRun}
          aria-label="Close"
          className="-mr-1 -mt-1 inline-flex h-7 w-7 items-center justify-center text-slate-500 transition-colors hover:text-slate-200"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <p className="mt-2 text-[13px] leading-relaxed text-slate-300">{feature.blurb}</p>

      {feature.shortcut && (
        <p className="mt-2 text-[11px] text-slate-500">
          Shortcut:{" "}
          <kbd className="rounded border border-slate-700 px-1.5 py-0.5 font-mono text-[10px] text-slate-300">
            {feature.shortcut}
          </kbd>
        </p>
      )}

      {feature.href && (
        <Link
          href={feature.href}
          onClick={endRun}
          className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-cyan-300 transition-colors hover:text-cyan-200"
        >
          {feature.ctaLabel ?? "Open"}
          <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      )}

      <div className="mt-4 flex items-center justify-between gap-2">
        <span className="text-[11px] uppercase tracking-wider text-slate-600">
          {total > 1 ? `Step ${run.index + 1} of ${total}` : ""}
        </span>
        <div className="flex items-center gap-2">
          {run.index > 0 && (
            <button
              type="button"
              onClick={runPrev}
              className="inline-flex items-center gap-1 px-2 py-1.5 text-xs text-slate-400 transition-colors hover:text-slate-200"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Back
            </button>
          )}
          {total > 1 && !isLast && (
            <button
              type="button"
              onClick={endRun}
              className="px-2 py-1.5 text-xs text-slate-500 transition-colors hover:text-slate-300"
            >
              Skip
            </button>
          )}
          <button
            type="button"
            onClick={runNext}
            className="inline-flex items-center gap-1.5 border border-cyan-500/50 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-200 transition-colors hover:bg-cyan-500/20"
          >
            {isLast ? (
              <>
                <Check className="h-3.5 w-3.5" /> Done
              </>
            ) : (
              <>
                Next <ArrowRight className="h-3.5 w-3.5" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(
    <div className="fixed inset-0 z-[200]">
      {centred ? (
        // No target on this page → dim everything and centre the explainer card.
        <div
          className="pointer-events-auto absolute inset-0 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm"
          onClick={endRun}
        >
          <div onClick={(e) => e.stopPropagation()}>{bubble}</div>
        </div>
      ) : (
        <>
          {/* Four dim panels leave a clear "hole" around the target (which stays
              visible and clickable). pointer-events on the panels block the rest. */}
          <Dim box={box!} onClick={endRun} />
          {/* Glowing ring around the target. */}
          <div
            className="animate-pulse-slow pointer-events-none fixed z-[205] border-2 border-cyan-400/80"
            style={{
              top: box!.top - HOLE_PAD,
              left: box!.left - HOLE_PAD,
              width: box!.width + HOLE_PAD * 2,
              height: box!.height + HOLE_PAD * 2,
              boxShadow: "0 0 0 9999px rgba(2,6,23,0.66), 0 0 18px rgba(34,211,238,0.45)",
            }}
          />
          {bubble}
        </>
      )}
    </div>,
    document.body
  );
}

/**
 * The clickable dim layer. We use a single full-screen catcher with a box-shadow
 * "hole" on the ring above; this transparent layer just intercepts clicks outside
 * the target so the page underneath doesn't react while the spotlight is open.
 */
function Dim({ box, onClick }: { box: Box; onClick: () => void }) {
  const panel = "fixed bg-transparent pointer-events-auto z-[204]";
  return (
    <>
      <div className={panel} style={{ top: 0, left: 0, right: 0, height: Math.max(0, box.top - HOLE_PAD) }} onClick={onClick} />
      <div
        className={panel}
        style={{ top: box.top + box.height + HOLE_PAD, left: 0, right: 0, bottom: 0 }}
        onClick={onClick}
      />
      <div
        className={panel}
        style={{ top: box.top - HOLE_PAD, left: 0, width: Math.max(0, box.left - HOLE_PAD), height: box.height + HOLE_PAD * 2 }}
        onClick={onClick}
      />
      <div
        className={panel}
        style={{ top: box.top - HOLE_PAD, left: box.left + box.width + HOLE_PAD, right: 0, height: box.height + HOLE_PAD * 2 }}
        onClick={onClick}
      />
    </>
  );
}
