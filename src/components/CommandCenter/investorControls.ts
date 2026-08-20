import {
  defaultTerminalFilters,
  type ControlDef,
  type TerminalFilterState,
} from "@/lib/personas/personaConfig";

/** Stable id for a control (slider/toggle use `key`, range uses `minKey`) — used to
 *  dedupe the persona-pinned set against the rest of the investor catalog. */
export const controlId = (c: ControlDef): string => (c.kind === "range" ? c.minKey : c.key);

/** True when a control's bound value(s) differ from the terminal defaults. */
export function isControlActive(c: ControlDef, f: TerminalFilterState): boolean {
  if (c.kind === "slider") return f[c.key] !== defaultTerminalFilters[c.key];
  if (c.kind === "range")
    return (
      f[c.minKey] !== defaultTerminalFilters[c.minKey] ||
      f[c.maxKey] !== defaultTerminalFilters[c.maxKey]
    );
  return f[c.key] !== defaultTerminalFilters[c.key];
}

/** Concise chip text: "Cap Rate ≥ 5%", "True DOM 60d–180d", "Stale Only". */
export function investorChipLabel(c: ControlDef, f: TerminalFilterState): string {
  if (c.kind === "toggle") return c.short ?? c.label;

  if (c.kind === "slider") {
    const name = c.short ?? c.label;
    if (f[c.key] === defaultTerminalFilters[c.key]) return name;
    return `${name} ${c.op ?? "≥"} ${c.format(f[c.key])}`;
  }

  // range
  const name = c.short ?? c.label;
  const lo = f[c.minKey];
  const hi = f[c.maxKey];
  const loActive = lo !== defaultTerminalFilters[c.minKey];
  const hiActive = hi !== defaultTerminalFilters[c.maxKey];
  if (!loActive && !hiActive) return name;
  if (loActive && hiActive) return `${name} ${c.format(lo)}–${c.format(hi)}`;
  if (loActive) return `${name} ≥ ${c.format(lo)}`;
  return `${name} ≤ ${c.format(hi)}`;
}

/**
 * Resolve a slider value that lands in the dead zone between "off" (0) and the
 * control's `minActive` floor. A cap rate under CAP_RATE_BAND.min reads the same as
 * "no estimate", so the query clamps to the floor — without this snap the chip
 * showed "Cap Rate ≥ 0.5%" while Typesense answered ≥1%, and 1,241 listings dropped
 * out with nothing on screen to explain it.
 *
 * The dead zone resolves in the DIRECTION OF TRAVEL: a drag up from off lands on
 * the floor, a drag down from an active value lands on off. A single sticky floor
 * would trap the user above "off" with no way back by drag.
 */
export function snapToActiveFloor(
  minActive: number | undefined,
  next: number,
  prev: number
): number {
  if (minActive === undefined || next <= 0 || next >= minActive) return next;
  return prev >= minActive ? 0 : minActive;
}

/** True when any of a persona's controls is non-default. */
export function anyControlActive(controls: ControlDef[], f: TerminalFilterState): boolean {
  return controls.some((c) => isControlActive(c, f));
}

/**
 * Reset a control's bound value(s) to the terminal defaults. Shared by the chip's
 * "×" (InvestorChip) and the active-filter strip token remove, so the clear
 * semantics can't drift between the two surfaces.
 */
export function resetControlToDefault(
  c: ControlDef,
  setFilter: <K extends keyof TerminalFilterState>(key: K, value: TerminalFilterState[K]) => void
): void {
  if (c.kind === "range") {
    setFilter(c.minKey, defaultTerminalFilters[c.minKey]);
    setFilter(c.maxKey, defaultTerminalFilters[c.maxKey]);
  } else {
    setFilter(c.key, defaultTerminalFilters[c.key]);
  }
}
