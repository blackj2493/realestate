/**
 * filterCommands — parse a free-text command-palette query into concrete filter
 * actions over the universal filter registry. This is what makes ⌘K terminal-native:
 * "under 800k", "4bd", "finished basement", "2 parking", "detached" all resolve to
 * the same filters the chips and drawer set, so every field is reachable from the
 * keyboard with zero scrolling.
 *
 * Pure + data-driven (it reads CORE_FILTERS / MORE_FILTERS), so adding a registry
 * field automatically makes its enum options and stepper units matchable here.
 * Execution (which store setter to call) lives in MapCommandPalette; this module
 * only decides WHAT to set, which keeps it trivially testable.
 */

import { CORE_FILTERS, MORE_FILTERS, FILTERS_BY_KEY, makePriceDef } from "@/lib/filters/filterRegistry";
import {
  priceConfig,
  typeOptionsForClass,
  type TransactionMode,
  type PropertyClass,
} from "@/lib/filters/fundamentals";
import type { StepperValue } from "@/lib/filters/types";

/** A resolved filter action. `control` tells the executor how to apply `value`/`option`. */
export type FilterCommand = {
  id: string;
  label: string;
  key: string;
} & (
  | { control: "range"; value: [number, number] }
  | { control: "stepper"; value: StepperValue }
  | { control: "enum"; option: string }
);

export interface ParseContext {
  transactionMode: TransactionMode;
  propertyClass: PropertyClass;
}

/** "800k" / "1.2m" / "$800,000" → 800000 / 1200000 / 800000 (null if unparseable). */
function parseMoney(s: string): number | null {
  const t = s.toLowerCase().replace(/[$,\s]/g, "");
  const m = t.match(/^(\d+(?:\.\d+)?)(k|m)?$/);
  if (!m) return null;
  let n = parseFloat(m[1]);
  if (m[2] === "k") n *= 1_000;
  else if (m[2] === "m") n *= 1_000_000;
  return Math.round(n);
}

const MONEY = "\\$?\\s*([\\d.,]+\\s*[km]?)";
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function parseFilterCommands(raw: string, ctx: ParseContext): FilterCommand[] {
  const q = raw.trim().toLowerCase();
  if (q.length < 2) return [];

  const out: FilterCommand[] = [];
  const seen = new Set<string>();
  const push = (cmd: FilterCommand) => {
    if (seen.has(cmd.id)) return;
    seen.add(cmd.id);
    out.push(cmd);
  };

  // ── Price ───────────────────────────────────────────────────────────────────
  const { min, max } = priceConfig(ctx.transactionMode);
  const priceDef = makePriceDef(priceConfig(ctx.transactionMode));
  const priceCmd = (lo: number, hi: number) => {
    const value: [number, number] = [clamp(lo, min, max), clamp(hi, min, max)];
    push({ id: `price:${value[0]}-${value[1]}`, key: "price", label: `Price ${priceDef.chipLabel(value)}`, control: "range", value });
  };
  let m: RegExpMatchArray | null;
  if ((m = q.match(new RegExp(`${MONEY}\\s*(?:-|–|to)\\s*${MONEY}`)))) {
    const a = parseMoney(m[1]);
    const b = parseMoney(m[2]);
    if (a !== null && b !== null) priceCmd(Math.min(a, b), Math.max(a, b));
  } else if ((m = q.match(new RegExp(`(?:under|below|max|<|≤|up to)\\s*${MONEY}`)))) {
    const v = parseMoney(m[1]);
    if (v !== null) priceCmd(min, v);
  } else if ((m = q.match(new RegExp(`(?:over|above|min|>|≥|at least|from)\\s*${MONEY}`)))) {
    const v = parseMoney(m[1]);
    if (v !== null) priceCmd(v, max);
  }

  // ── Beds / Baths (core steppers) ─────────────────────────────────────────────
  const stepCore = (key: "beds" | "baths", re: RegExp) => {
    const mm = q.match(re);
    if (!mm) return;
    const def = FILTERS_BY_KEY[key];
    const n = clamp(parseInt(mm[1], 10), 1, def.max ?? 7);
    const value: StepperValue = { n, exact: false };
    push({ id: `${key}:${n}`, key, label: def.chipLabel(value), control: "stepper", value });
  };
  stepCore("beds", /\b(\d{1,2})\s*\+?\s*(?:bd|bds|bed|beds|bedroom|bedrooms)\b/);
  stepCore("baths", /\b(\d{1,2})\s*\+?\s*(?:ba|bath|baths|bathroom|bathrooms)\b/);

  // ── Deep steppers (parking, kitchens, …) — driven by the registry's unit word ──
  for (const def of MORE_FILTERS) {
    if (def.control !== "stepper") continue;
    // The chip unit ("Parking", "Kitchen") is the word users type; match "2 parking"/"2+ kitchens".
    const unit = (def.key === "parking" ? "park(?:ing)?" : def.key === "kitchens" ? "kitchens?" : def.key);
    const mm = q.match(new RegExp(`\\b(\\d{1,2})\\s*\\+?\\s*${unit}\\b`));
    if (!mm) continue;
    const n = clamp(parseInt(mm[1], 10), 1, def.max ?? 8);
    const value: StepperValue = { n, exact: false };
    push({ id: `${def.key}:${n}`, key: def.key, label: def.chipLabel(value), control: "stepper", value });
  }

  // ── Property Type (class-scoped enum) ────────────────────────────────────────
  const homeTypeDef = FILTERS_BY_KEY.homeType;
  for (const opt of typeOptionsForClass(ctx.propertyClass)) {
    if (matchesEnumOption(q, opt.label)) {
      push({ id: `homeType:${opt.value}`, key: "homeType", label: `${homeTypeDef.label}: ${opt.label}`, control: "enum", option: opt.value });
    }
  }

  // ── Deep enums (basement, suite, occupancy, age, multi-unit) — registry-driven ─
  for (const def of [...CORE_FILTERS, ...MORE_FILTERS]) {
    if (def.control !== "enum" || def.key === "homeType") continue;
    for (const opt of def.options ?? []) {
      if (matchesEnumOption(q, opt.label)) {
        push({ id: `${def.key}:${opt.value}`, key: def.key, label: `${def.label}: ${opt.label}`, control: "enum", option: opt.value });
      }
    }
  }

  return out;
}

/** Loose, hyphen/space-insensitive containment so "walkout" hits "Walk-Out" and
 *  "finished basement" hits "Finished". Requires ≥4 alnum chars to avoid noise. */
function matchesEnumOption(q: string, optionLabel: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const label = norm(optionLabel);
  if (label.length < 4) return false;
  const query = norm(q);
  // query⊇label always; label⊇query only for ≥4-char queries, so "ap" can't pull in
  // every option while "semi" still resolves "Semi-Detached".
  return query.includes(label) || (query.length >= 4 && label.includes(query));
}
