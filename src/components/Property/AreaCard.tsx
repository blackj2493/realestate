"use client";

import { useState } from "react";
import SignInLink from "@/components/auth/SignInLink";
import { rentCheck, type AreaFacts, type AreaStats } from "@/lib/census/areaFacts";
import { track } from "@/lib/analytics/posthog";

/**
 * The area — Census 2021 facts for the blocks around this home, next to the same facts for
 * its city. Three lenses pick which four facts lead. Facts about PLACES only (housing,
 * tenure, commute, moves, costs, income): never facts about who lives there by a protected
 * ground (Ontario Human Rights Code; TRESA). See src/lib/census/characteristics.ts.
 *
 * Public data (Statistics Canada), so the facts are not VOW-gated. The rent check uses OUR
 * rent estimate, which is VOW-gated (it comes off signed leases), so it takes `rentLocked`.
 */
export type AreaLens = "investor" | "family" | "owner";

type FactKey = keyof Omit<AreaStats, "households">;

const FACTS: Record<FactKey, { label: string; unit: "pct" | "min" | "money" }> = {
  rentPct: { label: "Households that rent", unit: "pct" },
  ownPct: { label: "Households that own", unit: "pct" },
  moved5Pct: { label: "Moved in the last 5 years", unit: "pct" },
  aptPct: { label: "Homes that are apartments", unit: "pct" },
  bed3PlusPct: { label: "Homes with 3+ bedrooms", unit: "pct" },
  builtBefore1981Pct: { label: "Homes built before 1981", unit: "pct" },
  transitWalkBikePct: { label: "Transit, walk or bike to work", unit: "pct" },
  drivePct: { label: "Drive to work", unit: "pct" },
  medianCommuteMin: { label: "Typical commute", unit: "min" },
  tenantCostBurdenPct: { label: "Renters paying 30%+ of income on housing", unit: "pct" },
  medianIncome: { label: "Typical household income", unit: "money" },
};

const LENSES: Array<{ id: AreaLens; label: string; facts: FactKey[] }> = [
  { id: "investor", label: "Investor", facts: ["rentPct", "moved5Pct", "aptPct", "tenantCostBurdenPct"] },
  { id: "family", label: "Family", facts: ["bed3PlusPct", "transitWalkBikePct", "builtBefore1981Pct", "medianCommuteMin"] },
  { id: "owner", label: "Living here", facts: ["medianCommuteMin", "drivePct", "ownPct", "medianIncome"] },
];

function fmt(v: number, unit: "pct" | "min" | "money"): string {
  if (unit === "pct") return `${Math.round(v)}%`;
  if (unit === "min") return `${Math.round(v)} min`;
  return `$${Math.round(v / 1000)}k`;
}

const money = (n: number) => `$${Math.round(n).toLocaleString("en-CA")}`;

export default function AreaCard({
  census,
  listingId,
  rentMonthly,
  rentLocked,
  initialLens = "investor",
}: {
  census: AreaFacts;
  listingId: string;
  /** Our monthly rent estimate for the whole home (or the asking rent on a lease). */
  rentMonthly: number | null;
  /** True for an anon reader on a sale listing: the rent estimate is VOW data. */
  rentLocked: boolean;
  initialLens?: AreaLens;
}) {
  const [lens, setLens] = useState<AreaLens>(initialLens);
  const active = LENSES.find((l) => l.id === lens)!;
  const rows = active.facts
    .map((k) => ({ k, here: census.here[k], city: census.city[k], ...FACTS[k] }))
    .filter((r) => r.here != null);
  const check = !rentLocked && rentMonthly ? rentCheck(rentMonthly, census.incomeGroups) : null;
  const neighbours = census.das - 1;

  return (
    <section className="mb-6 rounded-xl border border-border bg-card p-4 dark:bg-card/40">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.09em] text-foreground">The area</h3>
        <div role="group" aria-label="Lens" className="ml-auto flex rounded-lg bg-muted p-1">
          {LENSES.map((l) => (
            <button
              key={l.id}
              type="button"
              aria-pressed={l.id === lens}
              onClick={() => {
                setLens(l.id);
                track("area_lens_switched", { listingId, lens: l.id });
              }}
              className={
                "min-h-[36px] rounded-md px-3 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 " +
                (l.id === lens ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")
              }
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Statistics Canada did not publish these figures for the blocks here.</p>
      ) : (
        <dl className="space-y-3">
          {rows.map((r) => {
            const max = r.unit === "pct" ? 100 : Math.max(r.here!, r.city ?? 0) * 1.15;
            return (
              <div key={r.k}>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-[13px] text-foreground">{r.label}</dt>
                  <dd className="shrink-0 text-right">
                    <span className="font-mono text-[15px] font-bold text-foreground">{fmt(r.here!, r.unit)}</span>
                    {r.city != null && (
                      <span className="ml-2 font-mono text-[11px] text-muted-foreground">
                        {census.cityName} {fmt(r.city, r.unit)}
                      </span>
                    )}
                  </dd>
                </div>
                <div className="mt-1 space-y-0.5" aria-hidden>
                  <div className="h-1.5 rounded-full bg-cyan-600" style={{ width: `${Math.min(100, (100 * r.here!) / max)}%` }} />
                  {r.city != null && (
                    <div className="h-1.5 rounded-full bg-slate-400/70" style={{ width: `${Math.min(100, (100 * r.city) / max)}%` }} />
                  )}
                </div>
              </div>
            );
          })}
        </dl>
      )}

      {lens === "investor" && (rentLocked || check) && (
        <div className="mt-4 rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-3">
          <p className="text-[13px] font-semibold text-foreground">Rent check: can local households pay this rent?</p>
          {rentLocked ? (
            <p className="mt-1 text-[13px] text-muted-foreground">
              Our rent estimate comes from signed leases.{" "}
              <SignInLink className="font-semibold text-cyan-700 underline-offset-2 hover:underline dark:text-cyan-300">
                Sign in to see it
              </SignInLink>
              .
            </p>
          ) : (
            check && (
              <>
                <p className="mt-1 text-[13px] leading-relaxed text-foreground">
                  <span className="font-mono font-bold">{money(rentMonthly!)}/mo</span> needs about{" "}
                  <span className="font-mono font-bold">{money(check.incomeNeeded)}/yr</span> at 30% of income.
                </p>
                <p className="mt-1 text-[13px] leading-relaxed text-foreground">
                  {check.atTop ? "At most" : "About"} <span className="font-mono font-bold">{check.sharePct}%</span> of
                  households here earn that or more.
                </p>
                <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
                  Incomes are 2020 household incomes before tax, from the 2021 Census. The census does not split
                  them into renters and owners here.
                </p>
              </>
            )
          )}
        </div>
      )}

      <p className="mt-4 font-mono text-[10px] leading-snug text-muted-foreground">
        Statistics Canada, Census 2021 ·{" "}
        {neighbours > 0 ? `this block and the ${neighbours} next to it` : "this block"}
        {census.pop ? ` (about ${(Math.round(census.pop / 100) * 100).toLocaleString("en-CA")} people)` : ""}
      </p>
    </section>
  );
}
