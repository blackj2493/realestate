/**
 * The Filters panel's lens layout — pure, shared by the phone sheet and the desktop drawer.
 *
 * Every lens gets the same skeleton (price, beds & baths, home type, then three short rows
 * to the deeper pages), so a reader learns one panel. What changes with the lens is:
 *
 *  - `block`: investor controls drawn open on the first page, straight under price. The
 *    Cashflow lens opens its financing card; Flipper opens True DOM and price drop; Builder
 *    opens frontage and lot. The homebuyer lens opens nothing extra — beds and type are its
 *    block, and they are on every lens.
 *  - `picks`: three or four one-tap presets with a live "homes in view" count each. They put
 *    the data no consumer portal has (suite potential, density, True DOM) on the first
 *    screen, without making the reader learn a slider to try it.
 *
 * Every investor control also sits in exactly one INVESTOR_GROUPS entry, which is how the
 * "Investor signals" page is laid out. The tests hold both lists to the control catalog.
 */

import {
  INVESTOR_CONTROLS,
  type ControlDef,
  type PersonaType,
  type TerminalFilterState,
} from "@/lib/personas/personaConfig";
import { DESC_SIGNALS_FILTER } from "@/lib/filters/descriptionFilters";
import type { DescriptionSignalId } from "@/lib/listings/descriptionSignals";

type SliderKey = Extract<ControlDef, { kind: "slider" }>["key"];
type ToggleKey = Extract<ControlDef, { kind: "toggle" }>["key"];

/** Same id rule as investorControls.controlId (range controls are named by their min key). */
const idOf = (c: ControlDef): string => (c.kind === "range" ? c.minKey : c.key);

export const CONTROL_BY_ID: Record<string, ControlDef> = Object.fromEntries(
  INVESTOR_CONTROLS.map((c) => [idOf(c), c])
);

/** The financing trio, drawn as one card wherever it appears (see FINANCING_CONTROL_KEYS). */
export const CASHFLOW_BLOCK = "cashflow";

export type PickDef =
  | { kind: "signal"; id: DescriptionSignalId; label: string }
  | { kind: "toggle"; key: ToggleKey; label: string }
  | { kind: "threshold"; key: SliderKey; value: number; label: string };

export interface LensPanel {
  /** Control ids opened on the first page, or CASHFLOW_BLOCK for the financing card. */
  block: string[];
  picks: PickDef[];
}

export const LENS_PANEL: Record<PersonaType, LensPanel> = {
  smart: {
    block: [],
    picks: [
      { kind: "signal", id: "separate_entrance", label: "Separate entrance" },
      { kind: "toggle", key: "duplexCandidate", label: "Suite potential" },
      { kind: "threshold", key: "minPriceDrop", value: 10000, label: "Price cut $10K+" },
      { kind: "signal", id: "walkout_basement", label: "Walk-out basement" },
    ],
  },
  cashflow: {
    block: [CASHFLOW_BLOCK],
    picks: [
      { kind: "threshold", key: "minCapRate", value: 5, label: "Cap rate 5%+" },
      { kind: "toggle", key: "duplexCandidate", label: "Suite / duplex" },
      { kind: "signal", id: "tenanted", label: "Tenanted" },
      { kind: "threshold", key: "minPriceDrop", value: 10000, label: "Price cut $10K+" },
    ],
  },
  flippers: {
    block: ["trueDomMin", "minPriceDrop"],
    picks: [
      { kind: "toggle", key: "staleOnly", label: "Stale listings" },
      { kind: "threshold", key: "minPriceDrop", value: 25000, label: "Price cut $25K+" },
      { kind: "signal", id: "power_of_sale", label: "Power of sale" },
      { kind: "signal", id: "needs_work", label: "Needs work" },
    ],
  },
  builders: {
    block: ["minFrontage", "minLotSqft"],
    picks: [
      { kind: "toggle", key: "zoningPotential", label: "Density ready" },
      { kind: "threshold", key: "minFrontage", value: 50, label: "50 ft+ frontage" },
      { kind: "threshold", key: "minLotSqft", value: 10000, label: "Lot 10,000+ sqft" },
      { kind: "threshold", key: "minSurplusParking", value: 2, label: "2+ surplus parking" },
    ],
  },
};

export interface InvestorGroup {
  id: string;
  label: string;
  /** Control ids, in display order. The financing trio is drawn as one card. */
  ids: string[];
}

/** The "Investor signals" page: every investor control, each in exactly one group. */
export const INVESTOR_GROUPS: InvestorGroup[] = [
  { id: "cashflow", label: "Cashflow", ids: ["cashflowPositiveOnly", "downPaymentPct", "interestRatePct"] },
  { id: "yield", label: "Yield & cost", ids: ["minCapRate", "maxCarryCost", "maxCapitalBurn"] },
  { id: "timing", label: "Deal timing", ids: ["trueDomMin", "minPriceDrop", "staleOnly"] },
  {
    id: "land",
    label: "Land & density",
    ids: ["duplexCandidate", "zoningPotential", "minSurplusParking", "minFrontage", "minLotSqft"],
  },
];

// ── Picks ────────────────────────────────────────────────────────────────────

export const pickKey = (p: PickDef): string =>
  p.kind === "signal" ? `signal:${p.id}` : p.kind === "toggle" ? `toggle:${p.key}` : `threshold:${p.key}:${p.value}`;

/** Which side of the query a pick needs: description signals, or the investor layer. */
export const pickNeedsInvestorLayer = (p: PickDef): boolean => p.kind !== "signal";

export interface PickState {
  filters: TerminalFilterState;
  /** The description signals currently selected. */
  signals: string[];
}

/**
 * A threshold pick is on only at its own value. A cap rate the reader dragged to 6% is
 * theirs, not "Cap rate 5%+", so the pick shows off and a tap sets it to 5%.
 */
export function isPickActive(p: PickDef, s: PickState): boolean {
  if (p.kind === "signal") return s.signals.includes(p.id);
  if (p.kind === "toggle") return s.filters[p.key] === true;
  return s.filters[p.key] === p.value;
}

export interface PickChange {
  filters?: Partial<TerminalFilterState>;
  signals?: string[];
}

/** What tapping the pick writes: on → off resets to the default, off → on applies it. */
export function togglePick(p: PickDef, s: PickState, defaults: TerminalFilterState): PickChange {
  const on = isPickActive(p, s);
  if (p.kind === "signal")
    return { signals: on ? s.signals.filter((id) => id !== p.id) : [...s.signals, p.id] };
  if (p.kind === "toggle") return { filters: { [p.key]: !on } as Partial<TerminalFilterState> };
  return { filters: { [p.key]: on ? defaults[p.key] : p.value } as Partial<TerminalFilterState> };
}

/**
 * The filter_by fragment that counts this pick's homes on top of the live search. It is
 * built from the pick's own control, so the count is exactly what tapping it would show.
 * Null when there is nothing to add (e.g. a control whose clause is empty).
 */
export function pickClause(p: PickDef, filters: TerminalFilterState): string | null {
  if (p.kind === "signal") return DESC_SIGNALS_FILTER.buildClause([p.id]);
  const control = CONTROL_BY_ID[p.key];
  if (!control) return null;
  const next = { ...filters, [p.key]: p.kind === "toggle" ? true : p.value } as TerminalFilterState;
  return control.buildClause(next);
}
