/**
 * Daylight Terminal — shared light-mode design primitives.
 *
 * These render the "instrument" grammar of the approved light redesign: a
 * tick-rule under every module head, teal corner register marks on panels, a
 * graticule readout for KPI strips, and solid saturated status-lights. The
 * device styling lives in globals.css (the `.dt-*` classes); this file is the
 * React surface.
 *
 * Theme policy: LIGHT gets the full Daylight treatment; DARK is the product's
 * main mode and is preserved. Colour-carrying primitives (StatusLight,
 * TempChip) reproduce the exact current dark chips via `dark:` variants, so
 * flipping to dark is visually unchanged. Purely decorative devices (the
 * tick-rule, register marks, channel ticks) are gated to light via `.dt-light`
 * or `:root:not(.dark)` scoping in the stylesheet.
 */

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const pad2 = (n: number) => String(n).padStart(2, "0");

/* ── ModuleHead ────────────────────────────────────────────────────────────
   The mono "channel label" that heads every module: teal channel ticks (light)
   / section glyph (dark) · title · zero-padded count · right-aligned meta, with
   a tick-rule beneath in light or a hairline in dark. */
export function ModuleHead({
  title,
  count,
  right,
  icon,
  className,
}: {
  title: ReactNode;
  count?: number;
  right?: ReactNode;
  /** Section glyph shown in DARK only (light uses the teal channel ticks). */
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="flex items-baseline gap-2.5">
        <span
          aria-hidden
          className="dt-light -translate-y-px font-mono text-[8px] leading-none"
          style={{ color: "var(--dt-sig)" }}
        >
          ▮▮
        </span>
        {icon && (
          <span className="hidden shrink-0 self-center text-cyan-400 dark:inline-flex">{icon}</span>
        )}
        <h2 className="terminal-font text-[13px] font-bold uppercase tracking-[0.14em] text-foreground">
          {title}
        </h2>
        {count != null && (
          <span className="terminal-font text-[11px] text-muted-foreground">[{pad2(count)}]</span>
        )}
        {right && (
          <span className="terminal-font ml-auto text-[10.5px] uppercase tracking-[0.04em] text-muted-foreground">
            {right}
          </span>
        )}
      </div>
      {/* plain hairline under the head in both modes (light previously used a
          graticule tick-rule; removed as too busy). Dark is unchanged. */}
      <div className="mt-2 h-px w-full bg-border" aria-hidden />
    </div>
  );
}

/* ── Panel ─────────────────────────────────────────────────────────────────
   Instrument panel: white card + teal corner register marks (light) / bordered
   slate card (dark, current look). */
export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("dt-panel dt-reg border border-border bg-card dark:bg-card/40", className)}>
      {children}
    </div>
  );
}

/* ── Readout ───────────────────────────────────────────────────────────────
   The graticule KPI strip — connected cells with faint dividers, register
   marks, and mono figures. `cols` controls the desktop column count. */
const READOUT_COLS: Record<3 | 4 | 6, string> = {
  3: "grid-cols-3",
  4: "grid-cols-2 sm:grid-cols-4",
  6: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-6",
};

export function Readout({
  children,
  cols = 4,
  className,
}: {
  children: ReactNode;
  cols?: 3 | 4 | 6;
  className?: string;
}) {
  return (
    <div
      className={cn(
        // LIGHT: one connected instrument panel (register marks + shadow, no gap).
        // DARK: reverts to the current gapped tiles (transparent ground, no panel).
        "dt-panel dt-reg grid gap-0 border border-border bg-card",
        "dark:gap-3 dark:border-0 dark:bg-transparent",
        READOUT_COLS[cols],
        className
      )}
    >
      {children}
    </div>
  );
}

type ReadoutTone = "default" | "sig" | "up" | "down";

const READOUT_TONE: Record<ReadoutTone, string> = {
  default: "text-foreground",
  sig: "text-[color:var(--dt-sig)] dark:text-cyan-400",
  up: "text-[color:var(--dt-up)] dark:text-emerald-400",
  down: "text-[color:var(--dt-down)] dark:text-rose-400",
};

export function ReadoutCell({
  label,
  value,
  sub,
  subTone = "default",
  tone = "default",
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  subTone?: ReadoutTone;
  tone?: ReadoutTone;
}) {
  return (
    // LIGHT: connected graticule cell (faint dividers). DARK: a self-contained
    // bordered tile on the card ground (matches the current watchlist tiles).
    <div className="border-l border-t border-[color:var(--dt-line2)] px-4 py-3.5 dark:border dark:border-border dark:bg-card/40 dark:px-3 dark:py-2">
      <div className="terminal-font flex items-center gap-1 text-[9.5px] font-semibold uppercase tracking-[0.09em] text-muted-foreground dark:text-[10px] dark:tracking-wider">
        {label}
      </div>
      <div
        className={cn(
          "terminal-font mt-1.5 truncate text-2xl font-semibold tracking-tight dark:mt-0 dark:text-lg dark:font-bold",
          READOUT_TONE[tone]
        )}
      >
        {value}
      </div>
      {sub != null && (
        <div className={cn("terminal-font mt-1 text-[10.5px]", subTone === "default" ? "text-muted-foreground" : READOUT_TONE[subTone])}>
          {sub}
        </div>
      )}
    </div>
  );
}

/* ── StatusLight ───────────────────────────────────────────────────────────
   Solid saturated chip (light) / translucent bordered chip (dark, current).
   The dark class strings reproduce the exact CHIP palette so the dark feed is
   unchanged. Light differentiates relisted=blue / new=green (per the mockup),
   both cyan in dark. */
export type StatusTone =
  | "live"
  | "relisted"
  | "new"
  | "off"
  | "sold"
  | "stale"
  | "leased"
  | "drop";

const STATUS_TONE: Record<StatusTone, { bg: string; dark: string }> = {
  live: { bg: "bg-[color:var(--dt-sig)]", dark: "dark:bg-cyan-400/10 dark:text-cyan-400 dark:border-cyan-400/30" },
  relisted: { bg: "bg-[color:var(--dt-cold)]", dark: "dark:bg-cyan-400/10 dark:text-cyan-400 dark:border-cyan-400/30" },
  new: { bg: "bg-[color:var(--dt-up)]", dark: "dark:bg-cyan-400/10 dark:text-cyan-400 dark:border-cyan-400/30" },
  off: { bg: "bg-[color:var(--dt-warn)]", dark: "dark:bg-amber-400/10 dark:text-amber-400 dark:border-amber-400/30" },
  sold: { bg: "bg-[color:var(--dt-down)]", dark: "dark:bg-rose-400/10 dark:text-rose-400 dark:border-rose-400/30" },
  stale: { bg: "bg-[color:var(--dt-down)]", dark: "dark:bg-rose-400/10 dark:text-rose-400 dark:border-rose-400/30" },
  leased: { bg: "bg-[color:var(--dt-violet)]", dark: "dark:bg-violet-400/10 dark:text-violet-400 dark:border-violet-400/30" },
  drop: { bg: "bg-[color:var(--dt-up)]", dark: "dark:bg-emerald-400/10 dark:text-emerald-400 dark:border-emerald-400/30" },
};

export function StatusLight({
  tone,
  children,
  className,
}: {
  tone: StatusTone;
  children: ReactNode;
  className?: string;
}) {
  const t = STATUS_TONE[tone];
  return (
    <span
      className={cn(
        "terminal-font inline-flex items-center gap-1.5 whitespace-nowrap rounded-[1px] border-0 px-[7px] py-0.5 text-[10px] font-semibold uppercase leading-none tracking-[0.03em] text-white",
        "dark:gap-0 dark:rounded dark:border dark:px-1.5 dark:py-0.5 dark:text-[9px] dark:font-bold dark:tracking-wider",
        t.bg,
        t.dark,
        className
      )}
    >
      <i className="dt-light h-[5px] w-[5px] shrink-0 bg-white/90" aria-hidden />
      {children}
    </span>
  );
}

/* ── TempChip ──────────────────────────────────────────────────────────────
   Market-temperature pill: solid (light) / translucent (dark, current). */
export type TempKind = "hot" | "balanced" | "cold";

const TEMP_TONE: Record<TempKind, { bg: string; dark: string }> = {
  hot: { bg: "bg-[color:var(--dt-down)]", dark: "dark:bg-rose-400/10 dark:text-rose-400 dark:border-rose-400/30" },
  balanced: { bg: "bg-[color:var(--dt-warn)]", dark: "dark:bg-amber-400/10 dark:text-amber-400 dark:border-amber-400/30" },
  cold: { bg: "bg-[color:var(--dt-cold)]", dark: "dark:bg-cyan-400/10 dark:text-cyan-400 dark:border-cyan-400/30" },
};

const TEMP_LABEL: Record<TempKind, string> = { hot: "Hot", balanced: "Balanced", cold: "Cold" };

export function TempChip({ kind, className }: { kind: TempKind; className?: string }) {
  const t = TEMP_TONE[kind];
  return (
    <span
      className={cn(
        "terminal-font inline-flex items-center rounded-full border-0 px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider text-white",
        "dark:rounded dark:border dark:px-1.5 dark:py-0.5 dark:text-[9px] dark:font-bold",
        t.bg,
        t.dark,
        className
      )}
    >
      {TEMP_LABEL[kind]}
    </span>
  );
}
