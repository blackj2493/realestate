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
    <label className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
      <span className="uppercase tracking-wide">Rent</span>
      <Input
        type="number"
        inputMode="decimal"
        value={value ?? seeded}
        onChange={(e) => onChange(Math.max(0, Number(e.target.value)))}
        className="h-10 w-full border-border bg-muted px-2 font-mono text-xs text-foreground md:h-6 md:w-20 md:px-1.5"
        aria-label="Monthly rent assumption"
      />
      <span className="text-amber-600 dark:text-amber-400/80">/mo est</span>
    </label>
  );
}
