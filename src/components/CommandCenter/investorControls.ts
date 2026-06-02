import {
  defaultTerminalFilters,
  type ControlDef,
  type TerminalFilterState,
} from "@/lib/personas/personaConfig";

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

/** True when any of a persona's controls is non-default. */
export function anyControlActive(controls: ControlDef[], f: TerminalFilterState): boolean {
  return controls.some((c) => isControlActive(c, f));
}
