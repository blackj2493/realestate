"use client";

import { useRef, useState } from "react";
import { hstRelief, reliefBand } from "@/lib/hst/newHomeRelief";
import { track } from "@/lib/analytics/posthog";

const fmt = (n: number) => `$${n.toLocaleString("en-CA")}`;

/** "How much HST would I save?" — one price in, one estimate out. */
export default function HstCalculator() {
  const [raw, setRaw] = useState("900,000");
  const tracked = useRef(false);
  const price = Number(raw.replace(/[^0-9]/g, ""));
  const relief = hstRelief(price);

  function onChange(v: string) {
    const digits = v.replace(/[^0-9]/g, "").slice(0, 9);
    setRaw(digits ? Number(digits).toLocaleString("en-CA") : "");
    const p = Number(digits);
    if (!tracked.current && p >= 100_000) {
      tracked.current = true;
      track("hst_calc_used", { band: reliefBand(p) });
    }
  }

  return (
    <section aria-labelledby="calc-title" className="rounded-lg border border-border bg-card p-5">
      <h2 id="calc-title" className="text-lg font-semibold text-foreground">
        How much HST would you save?
      </h2>
      <label htmlFor="hst-price" className="mt-3 block text-sm text-muted-foreground">
        Price of the new home
      </label>
      <div className="mt-1 flex max-w-xs items-center rounded-md border border-border bg-muted px-3">
        <span className="text-foreground">$</span>
        <input
          id="hst-price"
          inputMode="numeric"
          className="w-full bg-transparent px-2 py-2 text-lg text-foreground focus:outline-none"
          value={raw}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
      {price > 0 && (
        <div className="mt-4">
          <p className="text-sm text-muted-foreground">You save about</p>
          <p className="text-3xl font-bold text-emerald-700 dark:text-emerald-400">{fmt(relief)}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            {price <= 1_000_000
              ? "No HST at all. A resale home has no HST either, so you can compare the two prices directly."
              : price <= 1_500_000
                ? "The full $130,000 relief. You pay the HST above that."
                : price < 1_850_000
                  ? "The relief gets smaller as the price goes up from $1.5M to $1.85M."
                  : "Over $1.85M you get only the old $24,000 rebate."}
          </p>
        </div>
      )}
      <p className="mt-4 text-xs text-muted-foreground">
        Estimate only, not tax advice. It applies when you buy a new home from the builder, to live in yourself, and
        sign between April 1, 2026 and March 31, 2027. Your lawyer confirms the real amount.
      </p>
    </section>
  );
}
