"use client";

import React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Slider } from "@/components/ui/slider";
import { Popover } from "@/components/ui/popover";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";
import { type ControlDef } from "@/lib/personas/personaConfig";
import { useRangeHistogram } from "@/hooks/useRangeHistogram";
import { supportsHistogram, HISTOGRAM_BANDS } from "@/lib/filters/histogram";
import { isControlActive, investorChipLabel, resetControlToDefault, snapToActiveFloor } from "./investorControls";
import RangeHistogram from "./RangeHistogram";
import NumberInput from "./NumberInput";
import InfoDot from "@/components/ui/InfoDot";
import { FieldHeader, PANEL_INPUT, PANEL_SLIDER } from "./filterPanel/primitives";

const LABEL = "text-[10px] font-semibold uppercase tracking-wider";

const chipClass = (active: boolean) =>
  cn(
    "flex shrink-0 cursor-pointer items-center gap-1.5 border px-2.5 py-1.5 transition-all",
    LABEL,
    active
      ? "border-cyan-500/50 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300"
      : "border-border bg-card text-muted-foreground hover:border-border hover:text-foreground"
  );

/** Bar count scaled to the control's resolution (small integer ranges get fewer). */
function bandCount(min: number, max: number, step: number): number {
  return Math.min(HISTOGRAM_BANDS, Math.max(4, Math.round((max - min) / step)));
}

/**
 * Popover body for a slider/range investor control. Lives in its own component so
 * the histogram hook mounts only when the popover opens. The histogram shows the
 * metric's full distribution over the basic-filtered population (excludePersona),
 * so it never narrows to (or self-collapses on) the other investor controls.
 */
export function InvestorControlBody({
  control,
  variant = "popover",
  histogram = true,
}: {
  control: ControlDef;
  /** "panel": the Filters panel's larger slider, rounded inputs and plain-language header. */
  variant?: "popover" | "panel";
  /** False skips the distribution query (pages that open many sliders at once). */
  histogram?: boolean;
}) {
  const { filters, setFilter } = useCommandCenterStore();
  if (control.kind === "toggle") return null;

  const { min, max, step } = control;
  const bands = bandCount(min, max, step);
  // Highlight range for the histogram: a "≤" slider fills [min, v], a "≥" slider
  // fills [v, max], a range fills [lo, hi]. Narrow on control.kind directly.
  const lo =
    control.kind === "range" ? filters[control.minKey] : control.op === "≤" ? min : filters[control.key];
  const hi =
    control.kind === "range" ? filters[control.maxKey] : control.op === "≤" ? filters[control.key] : max;

  return (
    <InvestorControlInner
      control={control}
      lo={lo}
      hi={hi}
      min={min}
      max={max}
      step={step}
      bands={bands}
      setFilter={setFilter}
      filters={filters}
      variant={variant}
      histogram={histogram}
    />
  );
}

function InvestorControlInner({
  control,
  lo,
  hi,
  min,
  max,
  step,
  bands,
  setFilter,
  filters,
  variant,
  histogram,
}: {
  variant: "popover" | "panel";
  histogram: boolean;
  control: Exclude<ControlDef, { kind: "toggle" }>;
  lo: number;
  hi: number;
  min: number;
  max: number;
  step: number;
  bands: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setFilter: (key: any, value: any) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  filters: any;
}) {
  const panel = variant === "panel";
  const { counts, maxCount, loading } = useRangeHistogram({
    filterKey: control.kind === "range" ? control.minKey : control.key,
    // No field = no query (the hook no-ops on an unsupported field).
    field: histogram ? control.field : undefined,
    min,
    max,
    bands,
    excludePersona: true,
  });

  // Slider + typed input share one write path so the floor snap can't drift
  // between them. No-op for a control without `minActive`.
  const commit = (v: number) => {
    if (control.kind === "range") return;
    setFilter(control.key, snapToActiveFloor(control.minActive, v, filters[control.key]));
  };

  const valueText =
    control.kind === "range"
      ? `${control.format(filters[control.minKey])}–${control.format(filters[control.maxKey])}`
      : control.format(filters[control.key]);

  const active = isControlActive(control, filters);
  const sliderStyle = panel ? PANEL_SLIDER : {};
  const inputClass = panel ? PANEL_INPUT : undefined;

  return (
    <div className={cn("flex flex-col", panel ? "gap-3" : "gap-2")}>
      {panel ? (
        <FieldHeader
          label={
            <>
              {panelLabel(control.label)}
              {control.glossaryKey && <InfoDot term={control.glossaryKey} />}
            </>
          }
          value={active ? valueText : "Any"}
          active={active}
        />
      ) : (
        <div className="flex items-center justify-between">
          <span className={cn(LABEL, "flex items-center gap-1 text-muted-foreground")}>
            {control.label}
            {control.glossaryKey && <InfoDot term={control.glossaryKey} />}
          </span>
          <span className="font-mono text-xs text-cyan-700 dark:text-cyan-400">{valueText}</span>
        </div>
      )}

      {histogram && supportsHistogram(control.field) && (
        <RangeHistogram
          variant={variant}
          counts={counts}
          maxCount={maxCount}
          min={min}
          max={max}
          lo={lo}
          hi={hi}
          loading={loading}
        />
      )}

      {control.kind === "range" ? (
        <>
          <Slider
            value={[filters[control.minKey], filters[control.maxKey]]}
            min={min}
            max={max}
            step={step}
            ariaLabel={control.label}
            getAriaValueText={(v) => control.format(v)}
            onValueChange={([a, b]) => {
              setFilter(control.minKey, a);
              setFilter(control.maxKey, b);
            }}
            {...sliderStyle}
          />
          <div className="flex items-center gap-1.5">
            <NumberInput
              value={filters[control.minKey]}
              min={min}
              max={filters[control.maxKey]}
              onCommit={(n) => setFilter(control.minKey, n)}
              className={inputClass}
            />
            <span className="shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">to</span>
            <NumberInput
              value={filters[control.maxKey]}
              min={filters[control.minKey]}
              max={max}
              onCommit={(n) => setFilter(control.maxKey, n)}
              className={inputClass}
            />
          </div>
        </>
      ) : (
        <>
          <Slider
            value={[filters[control.key]]}
            min={min}
            max={max}
            step={step}
            ariaLabel={control.label}
            getAriaValueText={(v) => control.format(v)}
            onValueChange={([v]) => commit(v)}
            {...sliderStyle}
          />
          <div className="flex items-center gap-1.5">
            <span className="shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">
              {control.op ?? "≥"}
            </span>
            <NumberInput
              value={filters[control.key]}
              min={min}
              max={max}
              onCommit={(n) => commit(n)}
              className={inputClass}
            />
          </div>
        </>
      )}
    </div>
  );
}

/** "Max Carry Cost (CAD/Mo)" reads as a form field; the panel says "Max carry cost (CAD/Mo)". */
function panelLabel(label: string): string {
  return label.replace(/(?<=\s)([A-Z])(?=[a-z])/g, (c) => c.toLowerCase());
}

export default function InvestorChip({ control }: { control: ControlDef }) {
  const { filters, setFilter } = useCommandCenterStore();
  const active = isControlActive(control, filters);
  const text = investorChipLabel(control, filters);

  if (control.kind === "toggle") {
    return (
      <button className={chipClass(active)} onClick={() => setFilter(control.key, !filters[control.key])}>
        <span className={cn("h-1.5 w-1.5", active ? "bg-cyan-400" : "bg-slate-600")} />
        {text}
      </button>
    );
  }

  const clear = (e: React.MouseEvent) => {
    e.stopPropagation();
    resetControlToDefault(control, setFilter);
  };

  const trigger = (
    <span className={chipClass(active)}>
      {text}
      {active && <X className="h-3 w-3 opacity-70 hover:opacity-100" onClick={clear} />}
    </span>
  );

  return (
    <Popover trigger={trigger} className="w-56">
      <InvestorControlBody control={control} />
    </Popover>
  );
}
