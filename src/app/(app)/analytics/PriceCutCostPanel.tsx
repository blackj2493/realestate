"use client";

/**
 * "The cost of a price cut" — what a cut cost sellers in this area (migration 157).
 *
 * Self-fetching on purpose: it is the one panel the monthly Street Recap links to
 * (`?panel=price-cut-cost`), and keeping it out of the page's eleven-way prefetch means
 * a slow query here can never hold up the rest of the page.
 *
 * VOW: sold-price figures, so the route returns a locked shape to anyone not signed in.
 * The recap email links here and never prints these numbers (VOW Agreement §(f)).
 */

import { useEffect, useRef, useState } from "react";
import {
  BUCKET_LABEL,
  MIN_GROUP_SALES,
  parseAsk,
  soldFor,
  visibleGroups,
  type CutGroup,
  type PriceCutCost,
} from "@/lib/market/priceCutCost";

export const PRICE_CUT_PANEL_ID = "price-cut-cost";

const PRICE_CHECK_HREF =
  "mailto:support@pureproperty.ca?subject=" + encodeURIComponent("Free price check for my home");

const BAR_TONE = ["bg-emerald-600", "bg-amber-500", "bg-orange-600", "bg-rose-600"];

/** The worst group, inside a sentence: "Homes with a cut of 5% or more got …". */
const CUT_PHRASE: Record<CutGroup["bucket"], string> = {
  none: "no cut",
  under5: "a cut under 5%",
  "5to10": "a cut of 5% to 10%",
  over10: "a cut over 10%",
  "5plus": "a cut of 5% or more",
};

const money = (n: number) => `$${n.toLocaleString("en-CA")}`;

export function PriceCutCostPanel({
  region,
  typeKeys,
  focus,
}: {
  region: string;
  typeKeys: string[];
  /** Scroll here once the figures load (the email deep link). */
  focus?: boolean;
}) {
  const scope = `${region}|${[...typeKeys].sort().join(",")}`;
  const [res, setRes] = useState<{ scope: string; cost: PriceCutCost | null } | null>(null);
  const [askText, setAskText] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const scrolled = useRef(false);

  useEffect(() => {
    let alive = true;
    const t = typeKeys.length ? `&types=${encodeURIComponent(typeKeys.join(","))}` : "";
    fetch(`/api/market/price-cut-cost?region=${encodeURIComponent(region)}${t}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => alive && setRes({ scope, cost: (j?.cost as PriceCutCost) ?? null }))
      .catch(() => alive && setRes({ scope, cost: null }));
    return () => {
      alive = false;
    };
    // scope is derived from region + typeKeys; it is the only real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  const loading = res?.scope !== scope;
  const groups: CutGroup[] = !loading && res?.cost ? visibleGroups(res.cost.groups) : [];
  const months = res?.cost?.months ?? 12;
  const base = groups[0];
  const worst = groups[groups.length - 1];

  // Default the calculator to the typical first ask of a home that did not cut.
  const typedAsk = parseAsk(askText);
  const ask = typedAsk ?? (base?.medianFirstAsk ? Math.round(base.medianFirstAsk / 10_000) * 10_000 : null);

  useEffect(() => {
    if (!focus || loading || scrolled.current) return;
    scrolled.current = true;
    ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [focus, loading]);

  return (
    <div id={PRICE_CUT_PANEL_ID} ref={ref} className="mt-5 scroll-mt-20 border border-border bg-card/40 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="terminal-font text-[11px] font-bold uppercase tracking-wider text-foreground">
          The cost of a price cut
        </h2>
        <span className="terminal-font rounded-sm bg-cyan-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-cyan-700 dark:text-cyan-300">
          New
        </span>
        <span className="text-[11px] text-muted-foreground">
          what sellers got after a cut — last {months} months
        </span>
      </div>

      {loading ? (
        <div className="mt-4 h-40 w-full animate-pulse bg-muted/40" />
      ) : groups.length === 0 ? (
        <p className="mt-4 text-xs text-muted-foreground">
          Not enough sales here to compare. Each group needs {MIN_GROUP_SALES} or more sales. Try the
          city, or more home types.
        </p>
      ) : (
        <>
          <p className="mt-3 text-sm leading-relaxed text-foreground">
            Homes that sold with no price cut got <b>{base.pctOfFirstAsk.toFixed(1)}%</b> of their first
            asking price
            {base.medianDom != null ? (
              <>
                {" "}in <b>{base.medianDom} days</b>
              </>
            ) : null}
            . Homes with {CUT_PHRASE[worst.bucket]} got{" "}
            <b>{worst.pctOfFirstAsk.toFixed(1)}%</b>
            {worst.medianDom != null ? (
              <>
                {" "}and took <b>{worst.medianDom} days</b>
              </>
            ) : null}
            .
          </p>

          <div className="mt-4 space-y-3">
            {groups.map((g, i) => (
              <div key={g.bucket} className="grid grid-cols-[1fr_3.75rem] items-center gap-x-3 gap-y-1 sm:grid-cols-[8.5rem_1fr_4.5rem]">
                <div className="col-span-2 flex items-baseline gap-2 sm:col-span-1 sm:block">
                  <div className="text-xs font-bold text-foreground">{BUCKET_LABEL[g.bucket]}</div>
                  <div className="text-[11px] text-muted-foreground">{g.sales.toLocaleString()} sales</div>
                </div>
                <div className="relative h-6 w-full bg-muted/50">
                  <div
                    className={`absolute inset-y-0 left-0 ${BAR_TONE[i] ?? BAR_TONE[3]}`}
                    style={{ width: `${Math.min(100, g.pctOfFirstAsk)}%` }}
                  />
                  <span className="absolute left-2 top-1 font-mono text-xs font-bold text-white">
                    {g.pctOfFirstAsk.toFixed(1)}%
                  </span>
                </div>
                <div className="text-right font-mono text-sm text-foreground">
                  {g.medianDom ?? "—"}
                  <span className="ml-1 text-[11px] text-muted-foreground">days</span>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Sold price as a share of the first asking price, and days on the market. Median of each group.
          </p>

          {ask != null && (
            <div className="mt-5 border border-cyan-500/30 bg-cyan-500/5 p-3">
              <label className="block text-xs text-foreground" htmlFor="pcc-ask">
                If your first asking price is
              </label>
              <input
                id="pcc-ask"
                inputMode="decimal"
                className="mt-1 h-10 w-48 border border-border bg-background px-2 font-mono text-base font-bold"
                placeholder={money(ask)}
                value={askText}
                onChange={(e) => setAskText(e.target.value)}
              />
              <table className="mt-3 w-full text-xs sm:text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-cyan-700 dark:text-cyan-300">
                    <th className="py-1 text-left font-bold">If it sells like…</th>
                    <th className="py-1 pl-2 text-right font-bold">Sold for</th>
                    <th className="py-1 pl-2 text-right font-bold">Change</th>
                    <th className="py-1 pl-2 text-right font-bold">Days</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => {
                    const v = soldFor(ask, g.pctOfFirstAsk);
                    const diff = v - soldFor(ask, base.pctOfFirstAsk);
                    return (
                      <tr key={g.bucket} className="border-t border-border/60">
                        <td className="py-1.5">{BUCKET_LABEL[g.bucket]}</td>
                        <td className="py-1.5 pl-2 text-right font-mono font-bold">{money(v)}</td>
                        <td
                          className={`py-1.5 pl-2 text-right font-mono ${diff < 0 ? "font-bold text-rose-600 dark:text-rose-400" : "text-muted-foreground"}`}
                        >
                          {g === base ? "—" : `${diff < 0 ? "−" : "+"}${money(Math.abs(diff))}`}
                        </td>
                        <td className="py-1.5 pl-2 text-right font-mono">{g.medianDom ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-4 border-l-4 border-amber-500 bg-amber-500/10 p-3 text-xs leading-relaxed text-foreground">
            <b>Read this before you use the numbers.</b> A cut is not the only cause of the lower price.
            Some homes that got a cut had other problems too. The numbers show what happened to these
            sellers, not what will happen to you.
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-foreground">
              <b>The first price matters most.</b>{" "}
              <span className="text-muted-foreground">
                Get a free price check from a licensed agent before you list.
              </span>
            </p>
            <a
              href={PRICE_CHECK_HREF}
              className="inline-flex h-10 items-center bg-cyan-600 px-4 text-sm font-bold text-white hover:bg-cyan-700"
            >
              Ask for a price check →
            </a>
          </div>
        </>
      )}

      <p className="terminal-font mt-3 text-[10px] text-muted-foreground">
        source · sold records · cut = the last asking price was lower than the first asking price of the
        same listing · a relist at a lower price is not counted · groups under {MIN_GROUP_SALES} sales hidden
      </p>
    </div>
  );
}
