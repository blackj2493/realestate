"use client";

import React from "react";

interface NumberInputProps {
  value: number;
  min: number;
  max: number;
  onCommit: (n: number) => void;
}

/**
 * Editable numeric endpoint for a range/slider control: types freely, commits a
 * clamped number on blur/Enter. Uncontrolled + keyed by `value` so an external
 * change (slider drag) remounts it with the fresh value — no prop→state sync.
 */
export default function NumberInput({ value, min, max, onCommit }: NumberInputProps) {
  const commit = (el: HTMLInputElement) => {
    const n = Number(el.value.replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(n) || el.value.trim() === "") {
      el.value = String(value); // restore on invalid input
      return;
    }
    onCommit(Math.min(max, Math.max(min, n)));
  };
  return (
    <input
      key={value}
      type="text"
      inputMode="numeric"
      defaultValue={value}
      onBlur={(e) => commit(e.currentTarget)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      className="w-full border border-slate-700 bg-slate-950 px-2 py-1 text-center font-mono text-xs text-slate-200 focus:border-cyan-500/60 focus:outline-none"
    />
  );
}
