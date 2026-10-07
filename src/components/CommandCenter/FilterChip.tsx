"use client";

import React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Slider } from "@/components/ui/slider";
import { Popover } from "@/components/ui/popover";
import type { FilterDef, FilterValue } from "@/lib/filters/types";
import { readStepper } from "@/lib/filters/filterRegistry";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";
import { useRangeHistogram } from "@/hooks/useRangeHistogram";
import { supportsHistogram } from "@/lib/filters/histogram";
import RangeHistogram from "./RangeHistogram";
import NumberInput from "./NumberInput";
import SqftBandControl from "./SqftBandControl";

const LABEL = "text-[10px] font-semibold uppercase tracking-wider";

interface FilterChipProps {
  def: FilterDef;
  value: FilterValue;
  onChange: (value: FilterValue) => void;
  onClear: () => void;
}

export default function FilterChip({ def, value, onChange, onClear }: FilterChipProps) {
  const active = def.isActive(value);
  const chipText = active ? def.chipLabel(value) : def.label;

  const trigger = (
    <span
      className={cn(
        "flex cursor-pointer items-center gap-1.5 border px-2.5 py-1.5 transition-all",
        LABEL,
        active
          ? "border-cyan-500/50 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300"
          : "border-border bg-card text-muted-foreground hover:border-border hover:text-foreground"
      )}
    >
      {chipText}
      {active && (
        <X
          className="h-3 w-3 opacity-70 hover:opacity-100"
          role="button"
          aria-label={`Clear ${def.label} filter`}
          onClick={(e) => {
            e.stopPropagation();
            onClear();
          }}
        />
      )}
    </span>
  );

  return (
    // The bands control needs the extra width: the condo scale has 21 stops, and
    // at 224px each would be under 11px — too tight to read the tick labels.
    <Popover trigger={trigger} className={def.control === "bands" ? "w-80" : "w-56"}>
      <FilterControl def={def} value={value} onChange={onChange} />
    </Popover>
  );
}

/**
 * FilterControl — the bare expanded control (range slider / stepper / enum list)
 * with no chip or popover wrapper. Shared by FilterChip's popover (desktop) and
 * the mobile filter sheet, so the control logic lives in exactly one place.
 */
export function FilterControl({
  def,
  value,
  onChange,
  enumLayout = "list",
}: {
  def: FilterDef;
  value: FilterValue;
  onChange: (value: FilterValue) => void;
  /** "chips": wrapped pill buttons (mobile Filters sheet); "list": the popover checklist. */
  enumLayout?: "list" | "chips";
}) {
  return (
    <>
      {def.control === "range" && (
        <RangeControl def={def} value={value as [number, number]} onChange={onChange} />
      )}
      {def.control === "stepper" && (
        <StepperControl def={def} value={value} onChange={onChange} />
      )}
      {def.control === "enum" &&
        (enumLayout === "chips" ? (
          <EnumChips def={def} value={value as string[]} onChange={onChange} />
        ) : (
          <EnumControl def={def} value={value as string[]} onChange={onChange} />
        ))}
      {def.control === "bands" && (
        <SqftBandControl def={def} value={value} onChange={onChange} />
      )}
    </>
  );
}

function RangeControl({
  def,
  value,
  onChange,
}: {
  def: FilterDef;
  value: [number, number];
  onChange: (v: FilterValue) => void;
}) {
  const [lo, hi] = value;
  const min = def.min ?? 0;
  const max = def.max ?? 100;
  const step = def.step ?? 1;
  const { counts, maxCount, loading } = useRangeHistogram({
    filterKey: def.key,
    field: def.field,
    min,
    max,
  });
  const fmtValue = def.formatValue ?? ((v: number) => String(v));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className={cn(LABEL, "text-muted-foreground")}>{def.label}</span>
        <span className="font-mono text-xs text-cyan-700 dark:text-cyan-400">{def.chipLabel(value)}</span>
      </div>
      {supportsHistogram(def.field) && (
        <RangeHistogram
          counts={counts}
          maxCount={maxCount}
          min={min}
          max={max}
          lo={lo}
          hi={hi}
          loading={loading}
        />
      )}
      <Slider
        value={[lo, hi]}
        min={min}
        max={max}
        step={step}
        ariaLabel={def.label}
        getAriaValueText={fmtValue}
        onValueChange={(v) => onChange([v[0], v[1]] as [number, number])}
      />
      <div className="flex items-center gap-1.5">
        <NumberInput value={lo} min={min} max={hi} onCommit={(n) => onChange([n, hi])} />
        <span className="shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">to</span>
        <NumberInput value={hi} min={lo} max={max} onCommit={(n) => onChange([lo, n])} />
      </div>
    </div>
  );
}

function StepperControl({
  def,
  value,
  onChange,
}: {
  def: FilterDef;
  value: FilterValue;
  onChange: (v: FilterValue) => void;
}) {
  const { n: current, exact } = readStepper(value);
  const max = def.max ?? 7;
  const options = Array.from({ length: max + 1 }, (_, i) => i);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className={cn(LABEL, "text-muted-foreground")}>{def.label}</span>
        {/* Min = "N or more" (the default); Exact = "exactly N". Mode is preserved
            when the count changes, so toggling re-labels the buttons in place. */}
        <div className="flex border border-border">
          {[
            { label: "Min", exact: false },
            { label: "Exact", exact: true },
          ].map((m) => (
            <button
              key={m.label}
              onClick={() => onChange({ n: current, exact: m.exact })}
              className={cn(
                LABEL,
                "px-2 py-0.5 transition-colors",
                exact === m.exact
                  ? "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        {options.map((n) => (
          <button
            key={n}
            onClick={() => onChange({ n, exact })}
            className={cn(
              "h-7 w-9 border text-xs font-semibold transition-colors",
              current === n
                ? "border-cyan-500/60 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300"
                : "border-border bg-card text-muted-foreground hover:border-border"
            )}
          >
            {n === 0 ? "Any" : exact ? `${n}` : `${n}+`}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The same multi-select as EnumControl, drawn as wrapped pills — so on the phone sheet a
 * nine-option type list takes two rows instead of a screen, and looks like every other
 * multi-select there. No label: the sheet's section card already names it.
 */
function EnumChips({
  def,
  value,
  onChange,
}: {
  def: FilterDef;
  value: string[];
  onChange: (v: FilterValue) => void;
}) {
  const toggle = (val: string) => {
    onChange(value.includes(val) ? value.filter((x) => x !== val) : [...value, val]);
  };
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label={def.label}>
      {(def.options ?? []).map((opt) => {
        const on = value.includes(opt.value);
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={on}
            onClick={() => toggle(opt.value)}
            className={cn(
              "min-h-[36px] rounded-full border px-3 text-sm transition-colors",
              on
                ? "border-cyan-700 bg-cyan-700 text-white dark:border-cyan-500 dark:bg-cyan-600"
                : "border-border bg-card text-foreground hover:border-cyan-500/50"
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function EnumControl({
  def,
  value,
  onChange,
}: {
  def: FilterDef;
  value: string[];
  onChange: (v: FilterValue) => void;
}) {
  const facetDist = useCommandCenterStore((s) => s.searchResult?.facetDistribution);
  const counts = def.facetField ? facetDist?.[def.facetField] : undefined;
  const toggle = (val: string) => {
    onChange(value.includes(val) ? value.filter((x) => x !== val) : [...value, val]);
  };
  return (
    <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
      <span className={cn(LABEL, "mb-1 text-muted-foreground")}>{def.label}</span>
      {(def.options ?? []).map((opt) => {
        const checked = value.includes(opt.value);
        const n = counts?.[opt.value];
        return (
          <button
            key={opt.value}
            onClick={() => toggle(opt.value)}
            className={cn(
              "flex items-center justify-between gap-2 px-1 py-1 text-left text-xs transition-colors",
              checked ? "text-cyan-700 dark:text-cyan-300" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <span className="flex items-center gap-2">
              <span
                className={cn(
                  "flex h-3.5 w-3.5 items-center justify-center border",
                  checked ? "border-cyan-500 bg-cyan-500/20" : "border-border"
                )}
              >
                {checked && <span className="h-1.5 w-1.5 bg-cyan-400" />}
              </span>
              {opt.label}
            </span>
            {n !== undefined && (
              <span className="font-mono text-[10px] text-muted-foreground">{n.toLocaleString("en-US")}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
