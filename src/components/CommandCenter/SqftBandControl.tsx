"use client";

/**
 * SqftBandControl — interior size, filtered at the resolution the feed has.
 *
 * TRREB publishes residential size as a BAND ("1100-1500"), never a number:
 * measured 2026-07-30, zero of 119,503 active houses and condos carry an exact
 * BuildingAreaTotal. A conventional slider therefore filters on a midpoint that
 * was manufactured from a range every single time, and quietly drops every
 * listing whose band straddles the user's limit.
 *
 * So the thumbs here snap to REAL band edges — you cannot ask for 1,847 sqft,
 * because no listing in the feed can answer that. And the result splits into
 * "certain" (band sits inside the range) and "may match" (band straddles a
 * limit), which the user includes or excludes on purpose.
 *
 * The two TRREB vocabularies do not share edges — houses run in 9 coarse bands,
 * condos in 21 fine ones — so the scale is switchable. It is pure display state:
 * the stored value is always real square feet, so switching scales can never
 * silently change what was asked for.
 */

import React from "react";
import { cn } from "@/lib/utils";
import type { BandRangeValue, FilterDef, FilterValue } from "@/lib/filters/types";
import { readBandRange } from "@/lib/filters/filterRegistry";
import {
  bandsForScale,
  SQFT_OPEN_MAX,
  type SqftBand,
  type SqftScale,
} from "@/lib/listings/livingAreaBands";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";
import { useSqftBands } from "@/hooks/useSqftBands";

const LABEL = "text-[10px] font-semibold uppercase tracking-wider";

const fmt = (n: number) => n.toLocaleString("en-US");

/**
 * Map real sqft bounds onto band indices for the current scale. The value is the
 * source of truth, so a range picked on one scale still renders sensibly on the
 * other — it snaps outward to the nearest band edges rather than being lost.
 */
function indicesFor(bands: SqftBand[], lo: number, hi: number): [number, number] {
  const last = bands.length - 1;
  const iLo = Math.max(0, bands.findIndex((b) => b.hi > lo));
  const found = bands.findIndex((b) => b.hi >= hi);
  const iHi = found === -1 ? last : found;
  return [Math.min(iLo, last), Math.max(Math.min(iHi, last), Math.min(iLo, last))];
}

export default function SqftBandControl({
  def,
  value,
  onChange,
}: {
  def: FilterDef;
  value: FilterValue;
  onChange: (v: FilterValue) => void;
}) {
  const current = readBandRange(value);
  const homeType = useCommandCenterStore((s) => s.universalFilters.homeType);

  // Default the scale to whatever the user is already browsing; they can override.
  const impliedScale: SqftScale = React.useMemo(() => {
    const types = Array.isArray(homeType) ? (homeType as string[]) : [];
    return types.length > 0 && types.every((t) => /condo/i.test(t)) ? "condo" : "freehold";
  }, [homeType]);

  // Derived, not synced: null means "follow whatever the user is browsing", so
  // changing the property type re-scales automatically — but once they pick a
  // scale by hand it stays picked, instead of being stomped by the next type change.
  const [override, setScale] = React.useState<SqftScale | null>(null);
  const scale = override ?? impliedScale;

  const bands = React.useMemo(() => bandsForScale(scale), [scale]);
  const [iLo, iHi] = indicesFor(bands, current.lo, current.hi);
  const last = bands.length - 1;

  const counts = useSqftBands({ scale, lo: current.lo, hi: current.hi });
  const peak = counts.perBand.length ? Math.max(...counts.perBand) : 0;

  const trackRef = React.useRef<HTMLDivElement>(null);
  const dragging = React.useRef<"lo" | "hi" | null>(null);

  /** Commit band indices back as real sqft. The extremes always mean "no limit",
   *  so the top stop reads as "and up" on both scales. */
  const commit = React.useCallback(
    (a: number, b: number, patch?: Partial<BandRangeValue>) => {
      const next: BandRangeValue = {
        lo: a <= 0 ? 0 : bands[a].lo,
        hi: b >= last ? SQFT_OPEN_MAX : bands[b].hi,
        loose: current.loose,
        unsized: current.unsized,
        ...patch,
      };
      onChange(next);
    },
    [bands, last, current.loose, current.unsized, onChange]
  );

  const indexAt = React.useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el) return 0;
      const r = el.getBoundingClientRect();
      const i = Math.floor(((clientX - r.left) / r.width) * bands.length);
      return Math.max(0, Math.min(last, i));
    },
    [bands.length, last]
  );

  const onPointerMove = React.useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current) return;
      const i = indexAt(e.clientX);
      if (dragging.current === "lo") commit(Math.min(i, iHi), iHi);
      else commit(iLo, Math.max(i, iLo));
    },
    [commit, indexAt, iLo, iHi]
  );

  const startDrag = (which: "lo" | "hi") => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragging.current = which;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const endDrag = (e: React.PointerEvent) => {
    dragging.current = null;
    const t = e.target as HTMLElement;
    if (t.hasPointerCapture?.(e.pointerId)) t.releasePointerCapture(e.pointerId);
  };

  const onKey = (which: "lo" | "hi") => (e: React.KeyboardEvent) => {
    let d = 0;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") d = -1;
    else if (e.key === "ArrowRight" || e.key === "ArrowUp") d = 1;
    else if (e.key === "Home") d = -bands.length;
    else if (e.key === "End") d = bands.length;
    else return;
    e.preventDefault();
    if (which === "lo") commit(Math.max(0, Math.min(iHi, iLo + d)), iHi);
    else commit(iLo, Math.min(last, Math.max(iLo, iHi + d)));
  };

  const pct = 100 / bands.length;
  const topOpen = iHi >= last;
  const readout = `${fmt(bands[iLo].lo)} – ${topOpen ? "Max" : fmt(bands[iHi].hi)}`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className={cn(LABEL, "text-muted-foreground")}>{def.label}</span>
        {/* Scale is display-only: the stored value stays in real square feet. */}
        <div className="flex border border-border" role="group" aria-label="Size scale">
          {(["freehold", "condo"] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={scale === s}
              onClick={() => setScale(s)}
              className={cn(
                LABEL,
                "px-2 py-0.5 transition-colors",
                scale === s
                  ? "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {s === "freehold" ? "Houses" : "Condos"}
            </button>
          ))}
        </div>
      </div>

      <div className="font-mono text-sm font-semibold text-cyan-700 dark:text-cyan-400">
        {readout} <span className="text-[10px] font-normal text-muted-foreground">SQFT</span>
      </div>

      {/* Distribution + track. Every band is one equal-width segment regardless of
          how many square feet it spans, so each stop is an equal tap target. */}
      <div className="select-none touch-none">
        <div className="flex h-10 items-end gap-px" aria-hidden="true">
          {bands.map((b, i) => {
            const n = counts.perBand[i] ?? 0;
            const on = i >= iLo && i <= iHi;
            return (
              <span
                key={b.label}
                title={`${b.label}: ${fmt(n)}`}
                style={{ height: `${peak > 0 ? Math.max(8, (n / peak) * 100) : 8}%` }}
                className={cn(
                  "flex-1 transition-colors",
                  on ? "bg-cyan-500" : "bg-border"
                )}
              />
            );
          })}
        </div>

        <div
          ref={trackRef}
          className="relative h-7"
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onPointerDown={(e) => {
            const i = indexAt(e.clientX);
            if (Math.abs(i - iLo) <= Math.abs(i - iHi)) commit(Math.min(i, iHi), iHi);
            else commit(iLo, Math.max(i, iLo));
          }}
        >
          <div className="mt-1 flex h-1.5 gap-px" aria-hidden="true">
            {bands.map((b, i) => (
              <span
                key={b.label}
                className={cn("flex-1", i >= iLo && i <= iHi ? "bg-cyan-500" : "bg-muted")}
              />
            ))}
          </div>

          {(
            [
              ["lo", iLo * pct, `From ${fmt(bands[iLo].lo)} square feet`],
              ["hi", (iHi + 1) * pct, topOpen ? "No upper limit" : `Up to ${fmt(bands[iHi].hi)} square feet`],
            ] as const
          ).map(([which, left, text]) => (
            <div
              key={which}
              role="slider"
              tabIndex={0}
              aria-label={which === "lo" ? "Minimum size" : "Maximum size"}
              aria-valuemin={0}
              aria-valuemax={last}
              aria-valuenow={which === "lo" ? iLo : iHi}
              aria-valuetext={text}
              onPointerDown={startDrag(which)}
              onKeyDown={onKey(which)}
              style={{ left: `${left}%` }}
              className={cn(
                "absolute top-0 -ml-2.5 h-5 w-5 cursor-grab border-2 border-cyan-500 bg-background",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 active:cursor-grabbing"
              )}
            />
          ))}
        </div>

        <div className="mt-1 flex font-mono text-[8px] leading-none text-muted-foreground">
          {bands.map((b, i) => (
            <span
              key={b.label}
              className={cn(
                "flex-1 text-center",
                (i === iLo || i === iHi) && "font-semibold text-cyan-700 dark:text-cyan-400"
              )}
            >
              {i === last ? `${fmt(b.lo)}+` : b.tick}
            </span>
          ))}
        </div>
      </div>

      {/* What the band resolution is costing the answer, stated rather than hidden. */}
      <div className="flex flex-col divide-y divide-border border-t border-border">
        <CountRow
          n={counts.certain}
          tone="match"
          label="Match"
          hint="Whole size band is inside your range."
        />
        {counts.possible > 0 && (
          <CountRow
            n={counts.possible}
            tone="maybe"
            label="May match"
            hint="Size given as a range that crosses your limit."
            pressed={current.loose}
            onToggle={() => onChange({ ...current, loose: !current.loose })}
            onText="Included"
            offText="Excluded"
          />
        )}
        {counts.unsized > 0 && (
          <CountRow
            n={counts.unsized}
            tone="none"
            label="No size reported"
            hint="Never dropped without telling you."
            pressed={current.unsized}
            onToggle={() => onChange({ ...current, unsized: !current.unsized })}
            onText="Shown"
            offText="Hidden"
          />
        )}
      </div>
    </div>
  );
}

function CountRow({
  n,
  tone,
  label,
  hint,
  pressed,
  onToggle,
  onText,
  offText,
}: {
  n: number;
  tone: "match" | "maybe" | "none";
  label: string;
  hint: string;
  pressed?: boolean;
  onToggle?: () => void;
  onText?: string;
  offText?: string;
}) {
  const toneText =
    tone === "match"
      ? "text-cyan-700 dark:text-cyan-400"
      : tone === "maybe"
        ? "text-amber-700 dark:text-amber-400"
        : "text-muted-foreground";

  return (
    <div className="flex items-center gap-2 py-1.5">
      <span className={cn("min-w-[3.5rem] font-mono text-xs font-semibold tabular-nums", toneText)}>
        {fmt(n)}
      </span>
      <span className="flex-1 text-[11px] leading-tight text-foreground">
        {label}
        <span className="block text-[10px] text-muted-foreground">{hint}</span>
      </span>
      {onToggle && (
        <button
          type="button"
          aria-pressed={pressed}
          onClick={onToggle}
          className={cn(
            LABEL,
            "shrink-0 border px-1.5 py-1 transition-colors",
            pressed
              ? tone === "maybe"
                ? "border-amber-500/60 text-amber-700 dark:text-amber-400"
                : "border-cyan-500/60 text-cyan-700 dark:text-cyan-300"
              : "border-border text-muted-foreground hover:text-foreground"
          )}
        >
          {pressed ? onText : offText}
        </button>
      )}
    </div>
  );
}
