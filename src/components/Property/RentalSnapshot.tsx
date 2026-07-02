/**
 * RentalSnapshot — the right-rail card shown on FOR-LEASE listings in place of the
 * Underwriting Sandbox.
 *
 * Why it exists: the Underwriting Sandbox is a buy-and-hold acquisition model that
 * reads `ListPrice` as a purchase price. On a lease listing `ListPrice` is the
 * monthly rent, so the sandbox fabricated a $540 down payment and a 516% cap rate.
 * A lease has no acquisition to underwrite; its value to a cashflow investor is as a
 * RENT COMP. So we surface the lease economics — annualized rent, rent-per-sqft,
 * term, deposit — instead of inventing a purchase.
 *
 * Presentational only (no state, no client hooks): all figures come from the pure,
 * deterministic `buildRentalSnapshot`. Visual language mirrors UnderwritingSandbox.
 *
 * Compliance (CLAUDE.md §4): deterministic arithmetic over active-listing fields.
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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-muted/50 rounded p-2">
      <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</span>
      <p className="text-sm font-bold font-mono text-foreground">{value}</p>
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

  return (
    <div className={cn("bg-card rounded-lg border border-border p-4", className)}>
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <KeyRound className="h-4 w-4 text-sky-600 dark:text-sky-400" />
        <span className="text-sm font-semibold text-foreground uppercase tracking-wider">
          Rental Snapshot
        </span>
      </div>

      {/* Hero: monthly rent */}
      <div className="rounded-lg p-3 mb-4 border bg-sky-900/20 border-sky-800/50">
        <div className="flex items-center justify-between">
          <span className="text-xs uppercase tracking-wider text-sky-600 dark:text-sky-400">
            {leased ? "Leased Rent" : "Monthly Rent"}
          </span>
          <span className="text-2xl font-bold font-mono text-sky-300">
            {formatPrice(s.monthlyRent)}
          </span>
        </div>
        <span className="text-[10px] text-muted-foreground">
          {leased ? "achieved lease rate" : "asking rent — entire listing"}
        </span>
      </div>

      {/* Key metrics */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <Metric label="Annualized Rent" value={`${formatPrice(s.annualRent)}/yr`} />
        <Metric label="Rent / Sqft" value={rentPerSqftDisplay(s)} />
        <Metric label="Lease Term" value={s.leaseTerm ?? "—"} />
        <Metric label="Deposit" value={depositValue} />
      </div>

      {/* Included in rent */}
      {s.rentIncludes.length > 0 && (
        <div className="mb-4">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Included in Rent</span>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {s.rentIncludes.map((item) => (
              <span
                key={item}
                className="rounded bg-muted/60 px-2 py-0.5 text-[11px] text-foreground"
              >
                {item}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Why no underwriting box here */}
      <p className="text-[10px] text-muted-foreground leading-relaxed">
        This is a rental listing. Buy-and-hold underwriting — cap rate, cash-on-cash,
        cashflow — applies to a purchase, not a lease, so it isn&apos;t shown here.
        Use these figures as a rent comp when underwriting a comparable unit for sale.
      </p>
    </div>
  );
}
