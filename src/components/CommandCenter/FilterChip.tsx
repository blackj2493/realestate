"use client";

import React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Slider } from "@/components/ui/slider";
import { Popover } from "@/components/ui/popover";
import type { FilterDef, FilterValue } from "@/lib/filters/types";

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
          ? "border-cyan-500/50 bg-cyan-500/10 text-cyan-300"
          : "border-slate-800 bg-slate-900 text-slate-400 hover:border-slate-700 hover:text-slate-200"
      )}
    >
      {chipText}
      {active && (
        <X
          className="h-3 w-3 opacity-70 hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            onClear();
          }}
        />
      )}
    </span>
  );

  return (
    <Popover trigger={trigger} className="w-56">
      {def.control === "range" && (
        <RangeControl def={def} value={value as [number, number]} onChange={onChange} />
      )}
      {def.control === "stepper" && (
        <StepperControl def={def} value={value as number} onChange={onChange} />
      )}
      {def.control === "enum" && (
        <EnumControl def={def} value={value as string[]} onChange={onChange} />
      )}
    </Popover>
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
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className={cn(LABEL, "text-slate-400")}>{def.label}</span>
        <span className="font-mono text-xs text-cyan-400">{def.chipLabel(value)}</span>
      </div>
      <Slider
        value={value}
        min={def.min ?? 0}
        max={def.max ?? 100}
        step={def.step ?? 1}
        onValueChange={(v) => onChange([v[0], v[1]] as [number, number])}
      />
    </div>
  );
}

function StepperControl({
  def,
  value,
  onChange,
}: {
  def: FilterDef;
  value: number;
  onChange: (v: FilterValue) => void;
}) {
  const max = def.max ?? 7;
  const options = Array.from({ length: max + 1 }, (_, i) => i);
  return (
    <div className="flex flex-col gap-2">
      <span className={cn(LABEL, "text-slate-400")}>{def.label}</span>
      <div className="flex flex-wrap gap-1">
        {options.map((n) => (
          <button
            key={n}
            onClick={() => onChange(n)}
            className={cn(
              "h-7 w-9 border text-xs font-semibold transition-colors",
              value === n
                ? "border-cyan-500/60 bg-cyan-500/10 text-cyan-300"
                : "border-slate-800 bg-slate-900 text-slate-400 hover:border-slate-700"
            )}
          >
            {n === 0 ? "Any" : `${n}+`}
          </button>
        ))}
      </div>
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
  const toggle = (val: string) => {
    onChange(value.includes(val) ? value.filter((x) => x !== val) : [...value, val]);
  };
  return (
    <div className="flex flex-col gap-1">
      <span className={cn(LABEL, "mb-1 text-slate-400")}>{def.label}</span>
      {(def.options ?? []).map((opt) => {
        const checked = value.includes(opt.value);
        return (
          <button
            key={opt.value}
            onClick={() => toggle(opt.value)}
            className={cn(
              "flex items-center gap-2 px-1 py-1 text-left text-xs transition-colors",
              checked ? "text-cyan-300" : "text-slate-400 hover:text-slate-200"
            )}
          >
            <span
              className={cn(
                "flex h-3.5 w-3.5 items-center justify-center border",
                checked ? "border-cyan-500 bg-cyan-500/20" : "border-slate-600"
              )}
            >
              {checked && <span className="h-1.5 w-1.5 bg-cyan-400" />}
            </span>
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
