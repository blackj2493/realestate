"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
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
    <label className="flex items-center gap-1.5">
      <span className="terminal-font text-[10px] uppercase tracking-wider text-slate-500">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="border border-slate-700 bg-slate-900/60 px-2 py-1 text-xs text-slate-200 outline-none focus:border-cyan-500/60"
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

const minOpts = (max: number, suffix = "+") =>
  [{ v: 0, t: "Any" }].concat(
    Array.from({ length: max }, (_, i) => ({ v: i + 1, t: `${i + 1}${suffix}` }))
  );
const frontageOpts = [0, 30, 40, 50, 75, 100].map((v) => ({
  v,
  t: v === 0 ? "Any" : `${v}'+`,
}));

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
    !lens.basementFinished &&
    lens.minFrontage === 0;

  return (
    <div className="border border-slate-800 bg-slate-900/40 p-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        {/* Sale vs Rent — scopes every surface (the rest of the bar refines within it) */}
        <div className="flex items-center gap-2">
          <span className="terminal-font text-[10px] uppercase tracking-wider text-slate-500">
            For
          </span>
          <div className="flex border border-slate-700">
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
                    : "text-slate-400 hover:bg-slate-800"
                )}
              >
                {o.t}
              </button>
            ))}
          </div>
        </div>

        {/* Window */}
        <div className="flex items-center gap-2">
          <span className="terminal-font text-[10px] uppercase tracking-wider text-slate-500">
            Window
          </span>
          <div className="flex border border-slate-700">
            {ACTIVITY_WINDOWS.map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => set({ windowDays: w })}
                className={cn(
                  "terminal-font px-2.5 py-1 text-xs transition-colors",
                  lens.windowDays === w
                    ? "bg-cyan-500 text-slate-950"
                    : "text-slate-400 hover:bg-slate-800"
                )}
              >
                {WINDOW_LABEL[w] ?? `${w}D`}
              </button>
            ))}
          </div>
        </div>

        {/* Property type popover */}
        <div className="relative">
          <button
            type="button"
            onClick={() => (typeOpen ? setTypeOpen(false) : openTypes())}
            className="flex items-center gap-1.5 border border-slate-700 bg-slate-900/60 px-2.5 py-1 text-xs text-slate-200 hover:border-cyan-500/60"
          >
            <span className="terminal-font text-[10px] uppercase tracking-wider text-slate-500">
              Type
            </span>
            {typeSummary}
            <ChevronDown className="h-3 w-3 text-slate-500" />
          </button>
          {typeOpen && (
            <div className="absolute z-20 mt-1 w-60 border border-slate-700 bg-slate-900 p-3 shadow-xl">
              <button
                type="button"
                onClick={() => setDraftTypes([])}
                className={cn(
                  "mb-1 flex w-full items-center gap-2 px-1 py-1.5 text-left text-xs",
                  draftTypes.length === 0 ? "text-cyan-300" : "text-slate-300"
                )}
              >
                <span
                  className={cn(
                    "flex h-4 w-4 items-center justify-center border",
                    draftTypes.length === 0
                      ? "border-cyan-500 bg-cyan-500 text-slate-950"
                      : "border-slate-600"
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
                      className="flex w-full items-center gap-2 px-1 py-1.5 text-left text-xs text-slate-300 hover:text-slate-100"
                    >
                      <span
                        className={cn(
                          "flex h-4 w-4 items-center justify-center border",
                          on ? "border-cyan-500 bg-cyan-500 text-slate-950" : "border-slate-600"
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
                  className="border border-slate-700 px-3 py-1 text-xs text-slate-300 hover:bg-slate-800"
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

        {/* Min selectors */}
        <MinSelect
          label="Beds"
          value={lens.minBeds}
          options={minOpts(5)}
          onChange={(v) => set({ minBeds: v })}
        />
        <MinSelect
          label="Baths"
          value={lens.minBaths}
          options={minOpts(5)}
          onChange={(v) => set({ minBaths: v })}
        />
        <MinSelect
          label="Parking"
          value={lens.minGarage}
          options={minOpts(4)}
          onChange={(v) => set({ minGarage: v })}
        />
        <MinSelect
          label="Frontage"
          value={lens.minFrontage}
          options={frontageOpts}
          onChange={(v) => set({ minFrontage: v })}
        />

        {/* Basement */}
        <button
          type="button"
          onClick={() => set({ basementFinished: !lens.basementFinished })}
          className={cn(
            "flex items-center gap-2 border px-2.5 py-1 text-xs transition-colors",
            lens.basementFinished
              ? "border-cyan-500/50 bg-cyan-500/10 text-cyan-200"
              : "border-slate-700 text-slate-400 hover:border-slate-600"
          )}
        >
          <span
            className={cn(
              "flex h-4 w-4 items-center justify-center border",
              lens.basementFinished
                ? "border-cyan-500 bg-cyan-500 text-slate-950"
                : "border-slate-600"
            )}
          >
            {lens.basementFinished && <span className="text-[9px] font-black">✓</span>}
          </span>
          Finished basement
        </button>

        {!isDefault && (
          <button
            type="button"
            onClick={() =>
              onChange({ ...DEFAULT_ACTIVITY_LENS, windowDays: lens.windowDays })
            }
            className="terminal-font text-[10px] uppercase tracking-wider text-slate-500 underline-offset-2 hover:text-rose-400 hover:underline"
          >
            Clear filters
          </button>
        )}
      </div>
    </div>
  );
}
