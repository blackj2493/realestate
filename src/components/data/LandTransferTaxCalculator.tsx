"use client";

/**
 * Land transfer tax calculator: price, "in the City of Toronto", "first-time buyer". The maths is
 * landTransferTax() (src/lib/tax/landTransferTax.ts), the same function the static pages use.
 */
import { useId, useState } from "react";
import { landTransferTax } from "@/lib/tax/landTransferTax";

const money = (n: number) => `$${n.toLocaleString("en-CA", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

export default function LandTransferTaxCalculator({ defaultPrice, defaultToronto }: { defaultPrice: number; defaultToronto: boolean }) {
  const id = useId();
  const [raw, setRaw] = useState(defaultPrice.toLocaleString("en-CA"));
  const [toronto, setToronto] = useState(defaultToronto);
  const [firstTime, setFirstTime] = useState(false);
  const price = Number(raw.replace(/[^0-9.]/g, "")) || 0;
  const r = landTransferTax(price, { toronto, firstTime });

  return (
    <section className="mt-8 rounded-2xl border border-border bg-card/40 p-5 sm:p-6" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className="text-lg font-semibold">Land transfer tax calculator</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <label className="block text-sm">
          <span className="text-muted-foreground">Purchase price</span>
          <span className="mt-1 flex items-center rounded-lg border border-border bg-background px-3 focus-within:ring-2 focus-within:ring-teal-600/40">
            <span className="text-muted-foreground">$</span>
            <input
              inputMode="numeric"
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              onBlur={() => price > 0 && setRaw(Math.round(price).toLocaleString("en-CA"))}
              className="w-full bg-transparent px-2 py-2 text-base tabular-nums outline-none"
              aria-label="Purchase price in dollars"
            />
          </span>
        </label>
        <div className="flex flex-col gap-2 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={toronto} onChange={(e) => setToronto(e.target.checked)} className="h-4 w-4 accent-teal-600" />
            In the City of Toronto
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={firstTime} onChange={(e) => setFirstTime(e.target.checked)} className="h-4 w-4 accent-teal-600" />
            First-time home buyer
          </label>
        </div>
      </div>

      <dl className="mt-5 divide-y divide-border/60 text-sm" aria-live="polite">
        <div className="flex justify-between py-2">
          <dt>Ontario land transfer tax</dt>
          <dd className="tabular-nums">{money(r.ontario)}</dd>
        </div>
        {toronto && (
          <div className="flex justify-between py-2">
            <dt>Toronto municipal land transfer tax</dt>
            <dd className="tabular-nums">{money(r.toronto)}</dd>
          </div>
        )}
        {firstTime && (
          <div className="flex justify-between py-2">
            <dt>Ontario first-time buyer refund</dt>
            <dd className="tabular-nums">−{money(r.ontarioRefund)}</dd>
          </div>
        )}
        {firstTime && toronto && (
          <div className="flex justify-between py-2">
            <dt>Toronto first-time buyer rebate</dt>
            <dd className="tabular-nums">−{money(r.torontoRebate)}</dd>
          </div>
        )}
        <div className="flex justify-between py-3 text-base font-semibold">
          <dt>You pay</dt>
          <dd className="tabular-nums">{money(r.total)}</dd>
        </div>
      </dl>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        For a home (land with one or two single family residences). First-time buyer rules apply: you have never owned a home anywhere, you move in within
        9 months, and you are a Canadian citizen or permanent resident. Your lawyer confirms the amount at closing.
      </p>
    </section>
  );
}
