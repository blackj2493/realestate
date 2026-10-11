"use client";

/**
 * Building blocks of the Filters panel (phone sheet + desktop drawer), in the terminal's own
 * language: square edges, hairline borders, mono uppercase micro-labels and cyan for "set" —
 * the same classes as LayerChips, FundamentalToggle and the ActiveFilterStrip.
 *
 * Ergonomics drive the sizes, not the look: every tap target is at least 40px tall and
 * slider thumbs are 20px squares with a 48px hit area, so a thumb can work the panel
 * one-handed. State is shown by fill as well as colour, so it reads in both themes.
 */

import React from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** The terminal's micro-label (LayerChips, FundamentalToggle, the strip). */
export const LABEL = "text-[10px] font-semibold uppercase tracking-wider";

/** Slider classes for the panel: the terminal's thin track, a cyan fill and a square thumb. */
export const PANEL_SLIDER = {
  trackClassName: "h-1 bg-slate-200 dark:bg-slate-800",
  rangeClassName: "bg-cyan-500",
  thumbClassName: "h-5 w-5 border-2 border-cyan-500 bg-background",
} as const;

/**
 * Registry labels are Title Case for chips ("Max Carry Cost (CAD/Mo)"); a sentence reads
 * better where a label is not upper-cased. Acronyms (DOM, CAD) and words after "/" are kept.
 */
export function sentenceCase(label: string): string {
  return label.replace(/(?<=\s)([A-Z])(?=[a-z])/g, (c) => c.toLowerCase());
}

/** Number field beside panel sliders: the terminal input, a little taller for a thumb. */
export const PANEL_INPUT =
  "w-full border border-border bg-background px-2 py-2 text-center font-mono text-xs text-foreground focus:border-cyan-500/60 focus:outline-none";

export function PanelCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("space-y-3 border border-border bg-card p-4", className)}>{children}</div>;
}

/** Micro-label over a group of cards. */
export function GroupLabel({ children, icon }: { children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className={cn(LABEL, "flex items-center gap-1.5 pt-1 text-muted-foreground")}>
      {icon}
      {children}
    </div>
  );
}

/** A field's micro-label on the left, its current value on the right (cyan when set). */
export function FieldHeader({
  label,
  value,
  active,
  extra,
}: {
  label: React.ReactNode;
  value?: React.ReactNode;
  active?: boolean;
  extra?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className={cn(LABEL, "flex items-center gap-1.5 text-muted-foreground")}>{label}</span>
      <span className="flex items-center gap-2">
        {extra}
        {value !== undefined && (
          <span
            className={cn(
              "font-mono text-xs",
              active ? "font-semibold text-cyan-700 dark:text-cyan-400" : "text-muted-foreground"
            )}
          >
            {value}
          </span>
        )}
      </span>
    </div>
  );
}

export interface SegmentOption<T extends string | number> {
  value: T;
  label: string;
}

/** One-of-N row in the LayerChips idiom: bordered cells, the chosen one lit cyan. */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex divide-x divide-border border border-border bg-card">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cn(
              "min-h-[40px] flex-1 px-1 font-mono text-xs font-semibold transition-colors",
              on
                ? "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** A square on/off switch: hairline track, the knob fills cyan when on. */
export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-6 w-11 shrink-0 border transition-colors",
        checked ? "border-cyan-500/60 bg-cyan-500/15" : "border-border bg-muted"
      )}
    >
      <span
        className={cn(
          "absolute top-[3px] h-4 w-4 transition-all",
          checked ? "left-[22px] bg-cyan-500" : "left-[3px] bg-muted-foreground/60"
        )}
      />
    </button>
  );
}

/** A labelled on/off filter, with an optional hint. */
export function SwitchRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: React.ReactNode;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex min-h-[44px] items-center justify-between gap-3">
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">{label}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
      <Switch checked={checked} onChange={onChange} label={label} />
    </div>
  );
}

/** A row that opens a deeper page: icon, title, what is set (or offered), count, chevron. */
export function NavRow({
  icon,
  title,
  summary,
  active,
  count,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  summary: string;
  active: boolean;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[60px] w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/50 active:bg-muted"
    >
      <span
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center border",
          active
            ? "border-cyan-500/50 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300"
            : "border-border text-muted-foreground"
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-foreground">{title}</span>
        <span
          className={cn(
            "block truncate text-xs",
            active ? "font-mono font-semibold text-cyan-700 dark:text-cyan-400" : "text-muted-foreground"
          )}
        >
          {summary}
        </span>
      </span>
      {count > 0 && <CountBadge n={count} />}
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
    </button>
  );
}

/** The count badge the bar's Filters button uses. */
export function CountBadge({ n }: { n: number }) {
  return (
    <span className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-cyan-500 px-1 text-[10px] font-bold leading-none text-slate-950">
      {n}
    </span>
  );
}
