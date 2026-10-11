"use client";

/**
 * Building blocks of the Filters panel (phone sheet + desktop drawer): soft cards, a
 * sliding segmented control, a switch row and a drill-in row.
 *
 * Ergonomics drive the sizes: every tap target is at least 40px tall, sliders get 24px
 * thumbs (a fingertip, not a cursor), and state is shown by shape as well as colour (a
 * raised segment, a filled switch, a count badge), so it reads at a glance in both themes.
 */

import React from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** Slider classes for the panel: a soft track, a gradient fill and a large round thumb. */
export const PANEL_SLIDER = {
  trackClassName: "h-1.5 rounded-full bg-slate-200 dark:bg-slate-800",
  rangeClassName: "rounded-full bg-gradient-to-r from-cyan-600 to-teal-500 dark:from-cyan-500 dark:to-cyan-300",
  thumbClassName:
    "h-6 w-6 rounded-full border-2 border-cyan-600 bg-white shadow-md dark:border-cyan-400 dark:bg-slate-950 dark:shadow-[0_0_12px_rgba(34,211,238,0.45)]",
} as const;

/** Rounded number field used beside panel sliders. */
export const PANEL_INPUT =
  "w-full rounded-lg border border-border bg-background px-2 py-2 text-center font-mono text-sm text-foreground focus:border-cyan-500 focus:outline-none";

export function PanelCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "space-y-3 rounded-2xl bg-card p-4 shadow-[0_1px_2px_rgba(15,23,42,0.06)] dark:border dark:border-border dark:shadow-none",
        className
      )}
    >
      {children}
    </div>
  );
}

/** Small uppercase heading over a group of cards. */
export function GroupLabel({ children, icon }: { children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 px-1 pt-1 text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
      {icon}
      {children}
    </div>
  );
}

/** A field's name on the left, its current value on the right (accent when set). */
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
    <div className="flex items-baseline justify-between gap-3">
      <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">{label}</span>
      <span className="flex items-center gap-2">
        {extra}
        {value !== undefined && (
          <span
            className={cn(
              "font-mono text-xs",
              active ? "font-semibold text-cyan-700 dark:text-cyan-300" : "text-muted-foreground"
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

/** iOS-style segmented control: the chosen segment is raised (light) or lit (dark). */
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
    <div role="radiogroup" aria-label={ariaLabel} className="flex rounded-xl bg-slate-100 p-1 dark:bg-slate-900">
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
              "min-h-[38px] flex-1 rounded-lg px-1 text-sm font-semibold transition-all",
              on
                ? "bg-white text-foreground shadow-sm dark:bg-cyan-500/15 dark:text-cyan-300 dark:shadow-none dark:ring-1 dark:ring-cyan-500/50"
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
        "relative h-7 w-12 shrink-0 rounded-full transition-colors",
        checked
          ? "bg-gradient-to-r from-cyan-600 to-teal-500 dark:from-cyan-500 dark:to-cyan-400"
          : "bg-slate-300 dark:bg-slate-700"
      )}
    >
      <span
        className={cn(
          "absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all",
          checked ? "left-6" : "left-1"
        )}
      />
    </button>
  );
}

/** A labelled on/off filter, with an optional hint and a live count. */
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
        <span className="block text-sm font-semibold text-foreground">{label}</span>
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
      className="flex min-h-[60px] w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50 active:bg-muted"
    >
      <span
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
          active
            ? "bg-cyan-50 text-cyan-700 dark:bg-cyan-500/10 dark:text-cyan-300"
            : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-foreground">{title}</span>
        <span
          className={cn(
            "block truncate text-xs",
            active ? "font-medium text-cyan-700 dark:text-cyan-300" : "text-muted-foreground"
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

export function CountBadge({ n }: { n: number }) {
  return (
    <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-cyan-600 px-1.5 font-mono text-[11px] font-bold text-white dark:bg-cyan-500 dark:text-slate-950">
      {n}
    </span>
  );
}
