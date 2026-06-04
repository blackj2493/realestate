"use client";

import { Input } from "@/components/ui/input";

export default function RentInput({
  value,
  seeded,
  onChange,
}: {
  value: number | undefined;
  seeded: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="mt-1 flex items-center gap-1 text-[10px] text-slate-500">
      <span className="uppercase tracking-wide">Rent</span>
      <Input
        type="number"
        inputMode="numeric"
        value={value ?? seeded}
        onChange={(e) => onChange(Math.max(0, Number(e.target.value)))}
        className="h-6 w-20 border-slate-700 bg-slate-800 px-1.5 font-mono text-xs text-slate-200"
        aria-label="Monthly rent assumption"
      />
      <span className="text-amber-400/80">/mo est</span>
    </label>
  );
}
