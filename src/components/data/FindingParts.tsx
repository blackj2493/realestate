/**
 * Prose and figure primitives for /data/findings pieces.
 *
 * These exist so a finding's content file reads as the argument it is making rather
 * than as a wall of Tailwind, and so every piece renders tables, pull figures and
 * caveats identically. A reader who meets two findings should not be able to tell
 * they were written weeks apart.
 *
 * Everything here is server-safe (no client hooks) and takes its colours from the
 * theme tokens, so light and dark both resolve without per-element overrides.
 */
import type { ReactNode } from "react";

export function P({ children }: { children: ReactNode }) {
  return <p className="my-5 leading-[1.75] text-foreground/90">{children}</p>;
}

export function H2({ children }: { children: ReactNode }) {
  return (
    <h2 className="mt-12 text-2xl font-bold leading-snug tracking-tight text-foreground">{children}</h2>
  );
}

/**
 * The single number a reader should leave with. One per finding at most — a page
 * with three pull figures has no thesis, it has a list.
 */
export function Pull({ value, caption }: { value: ReactNode; caption: string }) {
  return (
    <div className="my-9 border-y-2 border-foreground py-6 text-center">
      <span className="block text-4xl font-bold leading-none tracking-tight text-cyan-700 sm:text-5xl dark:text-cyan-400">
        {value}
      </span>
      <span className="mx-auto mt-3 block max-w-[46ch] text-sm leading-relaxed text-muted-foreground">
        {caption}
      </span>
    </div>
  );
}

/**
 * Table wrapper. The scroll container is on the figure, not the page — a wide table
 * must never make the whole document scroll sideways on a phone.
 */
export function FigureTable({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <figure className="my-9">
      <figcaption className="terminal-font mb-3 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
        {caption}
      </figcaption>
      <div className="overflow-x-auto border-t-2 border-foreground">
        <table className="w-full border-collapse text-sm tabular-nums">{children}</table>
      </div>
    </figure>
  );
}

export function Th({ children, num = false }: { children: ReactNode; num?: boolean }) {
  return (
    <th
      className={`whitespace-nowrap border-b border-border px-3 py-2 align-bottom text-[10.5px] font-bold uppercase tracking-[0.08em] text-muted-foreground ${
        num ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  num = false,
  tone,
}: {
  children: ReactNode;
  num?: boolean;
  /** "down" = fell, "up" = rose. Semantic colour, kept off the accent hue. */
  tone?: "up" | "down" | "muted";
}) {
  const toneClass =
    tone === "down"
      ? "text-rose-700 dark:text-rose-400"
      : tone === "up"
        ? "text-emerald-700 dark:text-emerald-400"
        : tone === "muted"
          ? "text-muted-foreground"
          : "text-foreground/90";
  return (
    <td
      className={`border-b border-border px-3 py-2 ${num ? "whitespace-nowrap text-right" : "text-left"} ${toneClass}`}
    >
      {children}
    </td>
  );
}

/** Place name with a smaller qualifier under it (the city, or "all areas"). */
export function Place({ name, sub }: { name: string; sub?: string }) {
  return (
    <span className="font-semibold text-foreground">
      {name}
      {sub && <span className="block text-[11.5px] font-normal text-muted-foreground">{sub}</span>}
    </span>
  );
}

/**
 * A bar drawn to scale beside its value, so a column of rates reads as a shape
 * before it reads as numbers. `pct` is the value; `max` scales the bar.
 */
export function BarCell({ pct, max = 65 }: { pct: number; max?: number }) {
  const width = Math.max(2, Math.round((pct / max) * 100));
  return (
    <div className="flex min-w-[132px] items-center gap-2">
      <span
        className="h-2 shrink-0 rounded-[1px] bg-cyan-600 dark:bg-cyan-500"
        style={{ width: `${width}px` }}
        aria-hidden
      />
      <span className="text-[13.5px] font-semibold tabular-nums text-foreground">{pct.toFixed(1)}%</span>
    </div>
  );
}

/**
 * What we are NOT claiming. Every finding carries one.
 *
 * This block is the reason a reporter can use the piece: it tells them where the
 * number breaks before they stake a headline on it, which is the difference between
 * a source they come back to and one they quote once. It is also the honest place to
 * record the limits of a VOW-derived subset.
 */
export function Caveat({ title = "Read this before quoting", children }: { title?: string; children: ReactNode }) {
  return (
    <aside className="my-9 border border-border border-l-[3px] border-l-cyan-600 bg-card/40 p-5 text-sm dark:border-l-cyan-500">
      <h3 className="terminal-font text-[11px] font-bold uppercase tracking-[0.14em] text-cyan-700 dark:text-cyan-400">
        {title}
      </h3>
      <ul className="mt-3 space-y-3 leading-relaxed text-muted-foreground">{children}</ul>
    </aside>
  );
}

export function CaveatItem({ children }: { children: ReactNode }) {
  return <li>{children}</li>;
}
