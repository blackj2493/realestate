"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover } from "@/components/ui/popover";
import {
  ACTIVITY_WINDOWS,
  DEFAULT_ACTIVITY_LENS,
  type MarketActivityLens,
} from "@/lib/dashboard/config";
import { PROPERTY_TYPE_OPTIONS } from "@/lib/dashboard/propertyTypes";

const WINDOW_LABEL: Record<number, string> = {
  1: "1D",
  3: "3D",
  7: "7D",
  30: "30D",
  90: "90D",
  180: "180D",
};

function MinSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: number;
  options: { v: number; t: string }[];
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
      <span className="terminal-font text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="border border-border bg-card/60 px-2 py-1.5 text-xs text-foreground outline-none focus:border-cyan-500/60"
      >
        {options.map((o) => (
          <option key={o.v} value={o.v}>
            {o.t}
          </option>
        ))}
      </select>
    </label>
  );
}

const frontageOpts = [0, 30, 40, 50, 75, 100].map((v) => ({
  v,
  t: v === 0 ? "Any" : `${v}'+`,
}));

const STEP_LABEL = "terminal-font text-[10px] font-semibold uppercase tracking-wider";

/**
 * Count filter (beds / baths / parking) — mirrors the Command Center terminal's
 * stepper: a Min/Exact toggle plus an "Any, 1+/=1 … N+/=N" button grid, in a
 * portaled popover so it escapes the bar's horizontal-scroll clip.
 */
function StepperPopover({
  label,
  value,
  exact,
  max,
  onChange,
}: {
  label: string;
  value: number;
  exact: boolean;
  max: number;
  onChange: (next: { n: number; exact: boolean }) => void;
}) {
  const summary = value === 0 ? "Any" : exact ? `${value}` : `${value}+`;
  const options = Array.from({ length: max + 1 }, (_, i) => i);
  const trigger = (
    <span
      className={cn(
        "flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap border px-2.5 py-1 text-xs transition-colors",
        value > 0
          ? "border-cyan-500/50 bg-cyan-500/10 text-cyan-200"
          : "border-border bg-card/60 text-foreground hover:border-cyan-500/60"
      )}
    >
      <span className="terminal-font text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {summary}
      <ChevronDown className="h-3 w-3 text-muted-foreground" />
    </span>
  );
  return (
    <Popover trigger={trigger} className="w-52">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className={cn(STEP_LABEL, "text-muted-foreground")}>{label}</span>
          {/* Min = "N or more" (default); Exact = "exactly N". Mode survives a
              count change so toggling re-labels the grid in place. */}
          <div className="flex border border-border">
            {[
              { t: "Min", exact: false },
              { t: "Exact", exact: true },
            ].map((m) => (
              <button
                key={m.t}
                type="button"
                onClick={() => onChange({ n: value, exact: m.exact })}
                className={cn(
                  STEP_LABEL,
                  "px-2 py-0.5 transition-colors",
                  exact === m.exact
                    ? "bg-cyan-500/10 text-cyan-300"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {m.t}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          {options.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => onChange({ n, exact })}
              className={cn(
                "h-7 w-9 border text-xs font-semibold transition-colors",
                value === n
                  ? "border-cyan-500/60 bg-cyan-500/10 text-cyan-300"
                  : "border-border bg-card text-muted-foreground hover:border-border"
              )}
            >
              {n === 0 ? "Any" : exact ? `${n}` : `${n}+`}
            </button>
          ))}
        </div>
      </div>
    </Popover>
  );
}

export default function MarketActivityControls({
  lens,
  onChange,
}: {
  lens: MarketActivityLens;
  onChange: (lens: MarketActivityLens) => void;
}) {
  const [typeOpen, setTypeOpen] = useState(false);
  const [draftTypes, setDraftTypes] = useState<string[]>(lens.propertyTypes);

  const set = (patch: Partial<MarketActivityLens>) => onChange({ ...lens, ...patch });

  const openTypes = () => {
    setDraftTypes(lens.propertyTypes);
    setTypeOpen(true);
  };
  const toggleDraft = (key: string) =>
    setDraftTypes((d) => (d.includes(key) ? d.filter((k) => k !== key) : [...d, key]));
  const saveTypes = () => {
    set({ propertyTypes: draftTypes });
    setTypeOpen(false);
  };

  const typeSummary =
    lens.propertyTypes.length === 0
      ? "All types"
      : lens.propertyTypes.length === 1
        ? PROPERTY_TYPE_OPTIONS.find((o) => o.key === lens.propertyTypes[0])?.label ??
          "1 type"
        : `${lens.propertyTypes.length} types`;

  const isDefault =
    lens.transactionType === "sale" &&
    lens.propertyTypes.length === 0 &&
    lens.minBeds === 0 &&
    lens.minBaths === 0 &&
    lens.minGarage === 0 &&
    lens.basement === "any" &&
    lens.minFrontage === 0;

  return (
    <div className="border border-border bg-card/40 p-3">
      {/* Mobile: single-row horizontal scroll (no wrap) so 9 controls don't stack into
          a ragged blob; sm+ keeps the original wrapping layout. Children never shrink. */}
      <div className="flex items-center gap-3 overflow-x-auto no-scrollbar pb-1 sm:flex-wrap sm:gap-x-6 sm:gap-y-3 sm:overflow-visible sm:pb-0">
        {/* Sale vs Rent — scopes every surface (the rest of the bar refines within it) */}
        <div className="flex shrink-0 items-center gap-2 whitespace-nowrap">
          <span className="terminal-font text-[10px] uppercase tracking-wider text-muted-foreground">
            For
          </span>
          <div className="flex border border-border">
            {(
              [
                { v: "sale", t: "Sale" },
                { v: "lease", t: "Rent" },
              ] as const
            ).map((o) => (
              <button
                key={o.v}
                type="button"
                onClick={() => set({ transactionType: o.v })}
                aria-pressed={lens.transactionType === o.v}
                className={cn(
                  "terminal-font px-3 py-1 text-xs transition-colors",
                  lens.transactionType === o.v
                    ? "bg-cyan-500 text-slate-950"
                    : "text-muted-foreground hover:bg-muted"
                )}
              >
                {o.t}
              </button>
            ))}
          </div>
        </div>

        {/* Window */}
        <div className="flex shrink-0 items-center gap-2 whitespace-nowrap">
          <span className="terminal-font text-[10px] uppercase tracking-wider text-muted-foreground">
            Window
          </span>
          <div className="flex border border-border">
            {ACTIVITY_WINDOWS.map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => set({ windowDays: w })}
                className={cn(
                  "terminal-font px-2.5 py-1 text-xs transition-colors",
                  lens.windowDays === w
                    ? "bg-cyan-500 text-slate-950"
                    : "text-muted-foreground hover:bg-muted"
                )}
              >
                {WINDOW_LABEL[w] ?? `${w}D`}
              </button>
            ))}
          </div>
        </div>

        {/* Property type popover */}
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => (typeOpen ? setTypeOpen(false) : openTypes())}
            className="flex items-center gap-1.5 border border-border bg-card/60 px-2.5 py-1 text-xs text-foreground hover:border-cyan-500/60"
          >
            <span className="terminal-font text-[10px] uppercase tracking-wider text-muted-foreground">
              Type
            </span>
            {typeSummary}
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          </button>
          {typeOpen && (
            <div className="absolute z-20 mt-1 w-60 border border-border bg-card p-3 shadow-xl">
              <button
                type="button"
                onClick={() => setDraftTypes([])}
                className={cn(
                  "mb-1 flex w-full items-center gap-2 px-1 py-1.5 text-left text-xs",
                  draftTypes.length === 0 ? "text-cyan-300" : "text-foreground"
                )}
              >
                <span
                  className={cn(
                    "flex h-4 w-4 items-center justify-center border",
                    draftTypes.length === 0
                      ? "border-cyan-500 bg-cyan-500 text-slate-950"
                      : "border-border"
                  )}
                >
                  {draftTypes.length === 0 && <span className="text-[9px] font-black">✓</span>}
                </span>
                All property types
              </button>
              <div className="max-h-56 overflow-auto">
                {PROPERTY_TYPE_OPTIONS.map((o) => {
                  const on = draftTypes.includes(o.key);
                  return (
                    <button
                      key={o.key}
                      type="button"
                      onClick={() => toggleDraft(o.key)}
                      className="flex w-full items-center gap-2 px-1 py-1.5 text-left text-xs text-foreground hover:text-foreground"
                    >
                      <span
                        className={cn(
                          "flex h-4 w-4 items-center justify-center border",
                          on ? "border-cyan-500 bg-cyan-500 text-slate-950" : "border-border"
                        )}
                      >
                        {on && <span className="text-[9px] font-black">✓</span>}
                      </span>
                      {o.label}
                    </button>
                  );
                })}
              </div>
              <div className="mt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setTypeOpen(false)}
                  className="border border-border px-3 py-1 text-xs text-foreground hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveTypes}
                  className="border border-cyan-500/60 bg-cyan-500/20 px-3 py-1 text-xs text-cyan-200 hover:bg-cyan-500/30"
                >
                  Save
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Count steppers (Min/Exact) — mirror the terminal's beds/baths/parking */}
        <StepperPopover
          label="Beds"
          value={lens.minBeds}
          exact={lens.bedsExact}
          max={5}
          onChange={({ n, exact }) => set({ minBeds: n, bedsExact: exact })}
        />
        <StepperPopover
          label="Baths"
          value={lens.minBaths}
          exact={lens.bathsExact}
          max={5}
          onChange={({ n, exact }) => set({ minBaths: n, bathsExact: exact })}
        />
        <StepperPopover
          label="Parking"
          value={lens.minGarage}
          exact={lens.garageExact}
          max={4}
          onChange={({ n, exact }) => set({ minGarage: n, garageExact: exact })}
        />
        <MinSelect
          label="Frontage"
          value={lens.minFrontage}
          options={frontageOpts}
          onChange={(v) => set({ minFrontage: v })}
        />

        {/* Basement — Any / Finished / Unfinished (maps on both New and Sold) */}
        <div className="flex shrink-0 items-center gap-2 whitespace-nowrap">
          <span className="terminal-font text-[10px] uppercase tracking-wider text-muted-foreground">
            Basement
          </span>
          <div className="flex border border-border">
            {(
              [
                { v: "any", t: "Any" },
                { v: "finished", t: "Finished" },
                { v: "unfinished", t: "Unfinished" },
              ] as const
            ).map((o) => (
              <button
                key={o.v}
                type="button"
                onClick={() => set({ basement: o.v })}
                aria-pressed={lens.basement === o.v}
                className={cn(
                  "terminal-font px-2.5 py-1 text-xs transition-colors",
                  lens.basement === o.v
                    ? "bg-cyan-500 text-slate-950"
                    : "text-muted-foreground hover:bg-muted"
                )}
              >
                {o.t}
              </button>
            ))}
          </div>
        </div>

        {!isDefault && (
          <button
            type="button"
            onClick={() =>
              onChange({ ...DEFAULT_ACTIVITY_LENS, windowDays: lens.windowDays })
            }
            className="terminal-font shrink-0 whitespace-nowrap text-[10px] uppercase tracking-wider text-muted-foreground underline-offset-2 hover:text-rose-400 hover:underline"
          >
            Clear filters
          </button>
        )}
      </div>
    </div>
  );
}
