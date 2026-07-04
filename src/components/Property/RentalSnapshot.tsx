/**
 * RentalSnapshot — the right-rail card shown on FOR-LEASE listings in place of the
 * Underwriting Sandbox.
 *
 * Audience: the PROSPECTIVE TENANT. The Underwriting Sandbox is a buy-and-hold
 * acquisition model that reads `ListPrice` as a purchase price; on a lease `ListPrice`
 * is the monthly rent, so it fabricated a $540 down payment and a 516% cap rate. A
 * tenant has no acquisition to underwrite — they need to know whether they can AFFORD
 * to live here: the all-in monthly cost, the up-front cash, the income a landlord will
 * screen for, and the lease commitment. So we lead with those. (Rent-per-sqft, the
 * investor's rent-comp metric, is kept but demoted to a footnote.)
 *
 * Presentational only (no state, no client hooks): all figures come from the pure,
 * deterministic `buildRentalSnapshot`. Visual language mirrors UnderwritingSandbox.
 *
 * Compliance (CLAUDE.md §4): deterministic arithmetic over active-listing fields. The
 * move-in and income figures are clearly labelled guidelines (first + last month; rent
 * ≤ 30% of income), not listing facts.
 */

import React from "react";
import { KeyRound } from "lucide-react";
import { cn, formatPrice } from "@/lib/utils";
import { buildRentalSnapshot, type RentalSnapshotInput } from "@/lib/property/rentalSnapshot";

interface RentalSnapshotProps extends RentalSnapshotInput {
  /** True when the listing has already leased (label the rent as achieved, not asking). */
  leased?: boolean;
  className?: string;
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-slate-800/50 rounded p-2">
      <span className="text-[10px] text-slate-500 uppercase tracking-wider">{label}</span>
      <p className="text-sm font-bold font-mono text-slate-200">{value}</p>
      {hint && <span className="text-[9px] text-slate-500">{hint}</span>}
    </div>
  );
}

function rentPerSqftDisplay(s: ReturnType<typeof buildRentalSnapshot>): string {
  const r = s.rentPerSqft;
  if (!r) return "—";
  if (r.kind === "exact") return `$${r.low.toFixed(2)}`;
  return `$${r.low.toFixed(2)}–$${r.high.toFixed(2)}`;
}

export default function RentalSnapshot({ leased = false, className, ...input }: RentalSnapshotProps) {
  const s = buildRentalSnapshot(input);

  const depositValue =
    s.depositRequired === true ? "Required" : s.depositRequired === false ? "Not required" : "—";
  const rentSqft = rentPerSqftDisplay(s);

  return (
    <div className={cn("bg-slate-900/50 rounded-lg border border-slate-800 p-4", className)}>
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <KeyRound className="h-4 w-4 text-sky-400" />
        <span className="text-sm font-semibold text-slate-200 uppercase tracking-wider">
          Rental Snapshot
        </span>
      </div>

      {/* Hero: monthly rent */}
      <div className="rounded-lg p-3 mb-4 border bg-sky-900/20 border-sky-800/50">
        <div className="flex items-center justify-between">
          <span className="text-xs uppercase tracking-wider text-sky-400">
            {leased ? "Leased Rent" : "Monthly Rent"}
          </span>
          <span className="text-2xl font-bold font-mono text-sky-300">
            {formatPrice(s.monthlyRent)}
          </span>
        </div>
        <span className="text-[10px] text-slate-500">
          {leased ? "achieved lease rate" : "asking rent — entire listing"}
        </span>
      </div>

      {/* Key metrics — tenant affordability first (asking listings), lease terms always. */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        {!leased && s.monthlyRent > 0 && (
          <>
            <Metric label="Move-in (est.)" value={formatPrice(s.moveInEstimate)} hint="first + last month" />
            <Metric label="Income to qualify" value={`${formatPrice(s.incomeToQualify)}/yr`} hint="rent ≤ 30% of income" />
          </>
        )}
        <Metric label="Lease Term" value={s.leaseTerm ?? "—"} />
        <Metric label="Deposit" value={depositValue} />
      </div>

      {/* Included in rent */}
      {s.rentIncludes.length > 0 && (
        <div className="mb-3">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider">Included in Rent</span>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {s.rentIncludes.map((item) => (
              <span
                key={item}
                className="rounded bg-emerald-900/20 px-2 py-0.5 text-[11px] text-emerald-300"
              >
                {item}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Not included — core utilities the tenant likely pays on top of rent */}
      {s.utilitiesExtra.length > 0 && (
        <div className="mb-3">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider">You Likely Pay On Top</span>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {s.utilitiesExtra.map((item) => (
              <span
                key={item}
                className="rounded bg-amber-900/20 px-2 py-0.5 text-[11px] text-amber-300"
              >
                {item}
              </span>
            ))}
          </div>
          <span className="mt-1 block text-[9px] text-slate-500">
            Based on what the listing says is included — confirm with the landlord.
          </span>
        </div>
      )}

      {/* Footnote: annualized rent + the investor rent-comp metric, demoted */}
      <p className="text-[10px] text-slate-500 leading-relaxed">
        Annualized {formatPrice(s.annualRent)}/yr{rentSqft !== "—" ? ` · ${rentSqft}/sqft` : ""}.
        {!leased && " Move-in and income figures are typical guidelines, not listing terms."}
      </p>
    </div>
  );
}
