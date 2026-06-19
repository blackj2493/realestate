"use client";

import * as React from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { cn } from "@/lib/utils";

interface SliderProps
  extends React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root> {
  /** Tailwind bg class for the filled range. Defaults to emerald. */
  rangeClassName?: string;
  /** Tailwind bg class for the thumb(s). Defaults to emerald. */
  thumbClassName?: string;
  /** Accessible name for each thumb (e.g. "Price"). */
  ariaLabel?: string;
  /** Screen-reader text for a thumb's current value (e.g. 650000 → "$650k"). */
  getAriaValueText?: (value: number, index: number) => string;
}

const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  SliderProps
>(({ className, rangeClassName, thumbClassName, ariaLabel, getAriaValueText, ...props }, ref) => {
  // One thumb per value so range sliders get two draggable handles.
  const values = Array.isArray(props.value)
    ? (props.value as number[])
    : Array.isArray(props.defaultValue)
      ? (props.defaultValue as number[])
      : [0];
  const thumbCount = values.length;

  return (
    <SliderPrimitive.Root
      ref={ref}
      className={cn(
        "relative flex w-full touch-none select-none items-center py-1.5",
        className
      )}
      {...props}
    >
      <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden bg-slate-800">
        <SliderPrimitive.Range
          className={cn("absolute h-full", rangeClassName ?? "bg-cyan-700")}
        />
      </SliderPrimitive.Track>
      {Array.from({ length: thumbCount }).map((_, i) => (
        <SliderPrimitive.Thumb
          key={i}
          aria-label={ariaLabel}
          aria-valuetext={getAriaValueText ? getAriaValueText(values[i], i) : undefined}
          className={cn(
            "relative block h-3.5 w-3.5 border border-slate-950 ring-offset-slate-950 transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 after:absolute after:content-[''] after:inset-[-14px] after:rounded-full",
            thumbClassName ?? "bg-cyan-400"
          )}
        />
      ))}
    </SliderPrimitive.Root>
  );
});
Slider.displayName = SliderPrimitive.Root.displayName;

export { Slider };
