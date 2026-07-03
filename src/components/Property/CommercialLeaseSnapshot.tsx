/**
 * CommercialLeaseSnapshot — the right-rail card for COMMERCIAL for-lease listings
 * (commercial-gap Phase 1), replacing the residential RentalSnapshot there.
 *
 * Why a separate card: commercial leases are quoted on a basis (TRREB
 * ListPriceUnit) — total per month, $/sqft/yr, or total per year — and the
 * industry comparison number is the $/sqft/yr rate plus TMI, not a monthly
 * dwelling rent. buildCommercialLeaseSnapshot derives only what the quoted basis
 * supports; an unknown basis renders the asking figure verbatim and derives
 * nothing (no fabricated denominators).
 *
 * Presentational only (no state, no client hooks); visual language mirrors
 * RentalSnapshot/UnderwritingSandbox. Compliance (CLAUDE.md §4): deterministic
 * arithmetic over active-listing fields.
 */

import React from "react";
import { Building2 } from "lucide-react";
import { cn, formatPrice } from "@/lib/utils";
import {
  buildCommercialLeaseSnapshot,
  type CommercialLeaseInput,
} from "@/lib/property/rentalSnapshot";

interface CommercialLeaseSnapshotProps extends CommercialLeaseInput {
  /** True when the listing has already leased (label the rent as achieved, not asking). */
  leased?: boolean;
  className?: string;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-slate-800/50 rounded p-2">
      <span className="text-[10px] text-slate-500 uppercase tracking-wider">{label}</span>
      <p className="text-sm font-bold font-mono text-slate-200">{value}</p>
    </div>
  );
}

export default function CommercialLeaseSnapshot({
  leased = false,
  className,
  ...input
}: CommercialLeaseSnapshotProps) {
  const s = buildCommercialLeaseSnapshot(input);

  // Hero: lead with the basis the listing was actually quoted on.
  const heroValue =
    s.basis === "psf-year" && s.perSqftYear !== null
      ? `$${s.perSqftYear.toFixed(2)}/sqft/yr`
      : s.basis === "month" && s.monthlyRent !== null
        ? `${formatPrice(s.monthlyRent)}/mo`
        : s.basis === "year" && s.annualRent !== null
          ? `${formatPrice(s.annualRent)}/yr`
          : formatPrice(input.listPrice); // unknown basis: verbatim, no unit claim
  const heroCaption =
    s.basis === "unknown"
      ? "asking rent as listed — basis not specified in the feed"
      : leased
        ? "achieved lease rate"
        : "asking rent as quoted by the listing";

  return (
    <div className={cn("bg-slate-900/50 rounded-lg border border-slate-800 p-4", className)}>
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <Building2 className="h-4 w-4 text-sky-400" />
        <span className="text-sm font-semibold text-slate-200 uppercase tracking-wider">
          Lease Economics
        </span>
      </div>

      {/* Hero: the quoted rate */}
      <div className="rounded-lg p-3 mb-4 border bg-sky-900/20 border-sky-800/50">
        <div className="flex items-center justify-between">
          <span className="text-xs uppercase tracking-wider text-sky-400">
            {leased ? "Leased Rate" : "Asking Rate"}
          </span>
          <span className="text-2xl font-bold font-mono text-sky-300">{heroValue}</span>
        </div>
        <span className="text-[10px] text-slate-500">{heroCaption}</span>
      </div>

      {/* Derived economics — each cell self-hides ("—") when the basis can't support it */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <Metric
          label="Rent / Sqft / Yr"
          value={s.perSqftYear !== null ? `$${s.perSqftYear.toFixed(2)}` : "—"}
        />
        <Metric
          label="Monthly Total"
          value={s.monthlyRent !== null ? formatPrice(s.monthlyRent) : "—"}
        />
        <Metric
          label="Annual Total"
          value={s.annualRent !== null ? formatPrice(s.annualRent) : "—"}
        />
        <Metric
          label="Area"
          value={s.areaSqft !== null ? `${s.areaSqft.toLocaleString("en-CA")} sqft` : "—"}
        />
        <Metric label="TMI" value={s.tmiDisplay ?? "—"} />
        <Metric label="Lease Term" value={s.leaseTerm ?? "—"} />
      </div>

      {/* Included in rent */}
      {s.rentIncludes.length > 0 && (
        <div className="mb-4">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider">Included in Rent</span>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {s.rentIncludes.map((item) => (
              <span
                key={item}
                className="rounded bg-slate-800/60 px-2 py-0.5 text-[11px] text-slate-300"
              >
                {item}
              </span>
            ))}
          </div>
        </div>
      )}

      <p className="text-[10px] text-slate-600 leading-relaxed">
        Commercial lease terms (net vs. gross, TMI treatment, escalations) come from the
        listing as entered by the brokerage — confirm the rent basis and additional costs
        with the listing brokerage before comparing.
      </p>
    </div>
  );
}
