import type { ControlDef, TerminalFilterState } from "@/lib/personas/personaConfig";
import type { FilterDef, FilterValue } from "@/lib/filters/types";
import { isControlActive, investorChipLabel, resetControlToDefault } from "./investorControls";

/** A render-ready filter control (def + current value + setter). The same shape
 *  FilterBar already builds for the chips and the mobile sheet. */
export interface FilterItem {
  def: FilterDef;
  value: FilterValue;
  onChange: (value: FilterValue) => void;
}

/** One pill in the active-filter strip: a label, its colour tone, and how to clear it. */
export interface FilterToken {
  id: string;
  label: string;
  tone: "core" | "investor";
  onRemove: () => void;
}

type SetFilterFn = <K extends keyof TerminalFilterState>(
  key: K,
  value: TerminalFilterState[K]
) => void;

const freshDefault = (v: FilterValue): FilterValue =>
  Array.isArray(v) ? ([...v] as FilterValue) : v;

/**
 * Distil the bar's three filter families (universal core, user-added deep fields,
 * persona investor controls) into one flat, ordered token list of ONLY the active
 * filters. The strip renders these as a removable query sentence; each token's
 * onRemove resets exactly that filter to its default via the same setters the
 * chips use, so removing from the strip and clearing a chip stay in lock-step.
 *
 * `showAdvanced` mirrors FilterBar's comp-only gate (added + investor are
 * active-browse only); `showInvestor` mirrors the residential-sale investor gate.
 */
export function buildFilterTokens(opts: {
  coreItems: FilterItem[];
  addedItems: FilterItem[];
  controls: ControlDef[];
  filters: TerminalFilterState;
  setFilter: SetFilterFn;
  removeAddedFilter: (key: string) => void;
  showAdvanced: boolean;
  showInvestor: boolean;
}): FilterToken[] {
  const { coreItems, addedItems, controls, filters, setFilter, removeAddedFilter, showAdvanced, showInvestor } = opts;
  const tokens: FilterToken[] = [];

  for (const { def, value, onChange } of coreItems) {
    if (def.isActive(value)) {
      tokens.push({
        id: def.key,
        label: def.chipLabel(value),
        tone: "core",
        onRemove: () => onChange(freshDefault(def.defaultValue)),
      });
    }
  }

  if (showAdvanced) {
    for (const { def, value, onChange } of addedItems) {
      if (def.isActive(value)) {
        tokens.push({
          id: def.key,
          label: def.chipLabel(value),
          tone: "core",
          // Reset the value AND un-pin it from the bar — same as the chip's own ×.
          onRemove: () => {
            onChange(freshDefault(def.defaultValue));
            removeAddedFilter(def.key);
          },
        });
      }
    }

    if (showInvestor) {
      controls.forEach((c, i) => {
        if (isControlActive(c, filters)) {
          tokens.push({
            id: `investor-${i}`,
            label: investorChipLabel(c, filters),
            tone: "investor",
            onRemove: () => resetControlToDefault(c, setFilter),
          });
        }
      });
    }
  }

  return tokens;
}
