"use client";

import { useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, GitCompareArrows, Lock } from "lucide-react";
import { cn, formatPrice } from "@/lib/utils";
import type { ListingDocument } from "@/lib/typesense/client";
import type { CompareData, CompareEstimate } from "@/lib/property/getCompareData";
import { dealScoreFromDocument } from "@/lib/dealScore/fromListingDocument";
import { DealScoreBadge } from "@/components/Property/DealScoreCard";

type Better = "high" | "low" | null;

interface NumericMetric {
  label: string;
  get: (l: ListingDocument, est?: CompareEstimate) => number | null;
  format: (v: number) => string;
  better: Better;
  /** Show each non-winning column's gap to the best column (e.g. "+$80k"). */
  magnitude?: boolean;
}

interface TextMetric {
  label: string;
  get: (l: ListingDocument) => string;
}

const domOf = (l: ListingDocument): number | null =>
  l.TrueDom ?? l.calculatedDOM ?? l.DaysOnMarket ?? null;

const priceDropPct = (l: ListingDocument): number | null => {
  if (!l.OriginalListPrice || !l.ListPrice || l.OriginalListPrice <= l.ListPrice) return 0;
  return Math.round(((l.OriginalListPrice - l.ListPrice) / l.OriginalListPrice) * 100);
};

/** Discount vs our estimate: (estimate − list) / estimate × 100. Positive = under (cheaper). */
const discountPctOf = (l: ListingDocument, est?: CompareEstimate): number | null => {
  if (!est || !est.estimatedValue || est.estimatedValue <= 0 || !l.ListPrice) return null;
  return ((est.estimatedValue - l.ListPrice) / est.estimatedValue) * 100;
};

const ppsfOf = (l: ListingDocument, est?: CompareEstimate): number | null => {
  if (est?.ppsf && est.ppsf > 0) return est.ppsf;
  // Fallback to the (rarely-present) exact BuildingAreaTotal if no precomputed GLA.
  return l.BuildingAreaTotal && l.BuildingAreaTotal > 0 ? l.ListPrice / l.BuildingAreaTotal : null;
};

const fmtMoney = (v: number) => `$${Math.round(v).toLocaleString()}`;

const NUMERIC_METRICS: NumericMetric[] = [
  { label: "List Price", get: (l) => l.ListPrice ?? null, format: formatPrice, better: "low", magnitude: true },
  { label: "Price / Sqft", get: ppsfOf, format: fmtMoney, better: "low", magnitude: true },
  { label: "Beds", get: (l) => l.BedroomsTotal ?? null, format: (v) => `${v}`, better: null },
  { label: "Baths", get: (l) => l.BathroomsTotalInteger ?? null, format: (v) => `${v}`, better: null },
  { label: "Parking", get: (l) => l.ParkingTotal ?? null, format: (v) => `${v}`, better: null },
  { label: "True DOM", get: domOf, format: (v) => `${v} days`, better: "high" },
  { label: "Price Drop", get: priceDropPct, format: (v) => `${v}%`, better: "high" },
  {
    label: "Cap Rate",
    get: (l) => l.ExtrapolatedCapRate ?? null,
    format: (v) => `${v.toFixed(1)}%`,
    better: "high",
  },
  {
    label: "Monthly Carry",
    get: (l) => l.MonthlyCarryCost ?? null,
    format: (v) => `${formatPrice(Math.round(v))}/mo`,
    better: "low",
  },
  { label: "Annual Taxes", get: (l) => l.TaxAnnualAmount ?? null, format: formatPrice, better: "low" },
  { label: "Monthly Fees", get: (l) => l.AssociationFee ?? null, format: formatPrice, better: "low" },
];

const TEXT_METRICS: TextMetric[] = [
  { label: "Type", get: (l) => l.PropertySubType || l.PropertyType || "—" },
  {
    label: "Suite",
    get: (l) =>
      l.SuiteStatus === "EXISTING_SUITE"
        ? "Income suite"
        : l.SuiteStatus === "POTENTIAL_CANDIDATE" || l.hasSecondarySuitePotential
        ? "Suite potential"
        : "None",
  },
  // Brokerage display is mandatory (TRREB §4).
  { label: "Brokerage", get: (l) => l.ListOfficeName || "—" },
];

/** Indices of the winning column(s) for a metric; empty unless ≥2 columns have data. */
function bestIndices(values: (number | null)[], better: Better): Set<number> {
  if (!better) return new Set();
  const valid = values
    .map((v, i) => ({ v, i }))
    .filter((x): x is { v: number; i: number } => x.v != null);
  if (valid.length < 2) return new Set();
  const best = better === "high" ? Math.max(...valid.map((x) => x.v)) : Math.min(...valid.map((x) => x.v));
  return new Set(valid.filter((x) => x.v === best).map((x) => x.i));
}

/** Best numeric value among the columns for magnitude deltas, or null. */
function bestValue(values: (number | null)[], better: Better): number | null {
  const valid = values.filter((v): v is number => v != null);
  if (valid.length < 2 || !better) return null;
  return better === "high" ? Math.max(...valid) : Math.min(...valid);
}

export default function CompareClient({
  listings,
  estimates,
  isAuthed,
}: CompareData & { isAuthed: boolean }) {
  const estOf = (l: ListingDocument): CompareEstimate | undefined => estimates[l.id];

  const winners = useMemo(() => {
    const m = new Map<string, Set<number>>();
    for (const metric of NUMERIC_METRICS) {
      m.set(metric.label, bestIndices(listings.map((l) => metric.get(l, estOf(l))), metric.better));
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listings, estimates]);

  // Deal Score now includes the AVM "Value vs Estimate" component → matches the
  // detail page (the comparison grid previously dropped it for lack of an estimate).
  const dealScores = useMemo(
    () =>
      listings.map((l) => {
        const e = estOf(l);
        return dealScoreFromDocument(
          l,
          e?.estimatedValue && e.confidence
            ? { estimatedValue: e.estimatedValue, confidence: e.confidence }
            : null
        );
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [listings, estimates]
  );
  const dealBest = useMemo(() => bestIndices(dealScores.map((d) => d.score), "high"), [dealScores]);

  // vs Estimate: highest discount (most under our estimate) is the best deal.
  const discountValues = listings.map((l) => discountPctOf(l, estOf(l)));
  const discountBest = bestIndices(discountValues, "high");

  if (listings.length === 0) {
    return (
      <div className="mx-auto max-w-[1400px] px-4 py-6">
        <Header />
        <div className="py-20 text-center text-slate-400">
          <p className="mb-4">No properties to compare.</p>
          <Link
            href="/properties"
            className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
          >
            ← Pick properties in the Command Center
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6">
      <Header />
      {!isAuthed && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-cyan-500/30 bg-cyan-500/5 px-4 py-2.5">
          <p className="text-xs text-slate-300">
            <Lock className="mr-1.5 inline h-3.5 w-3.5 text-cyan-400" />
            Estimates, deal scores &amp; sold-derived metrics are members-only.
          </p>
          <Link
            href={`/login?next=${encodeURIComponent(
              `/properties/compare?ids=${listings.map((l) => l.id).join(",")}`
            )}`}
            className="shrink-0 rounded-md border border-cyan-400/50 bg-cyan-500/20 px-3 py-1.5 text-xs font-semibold text-cyan-100 transition-colors hover:bg-cyan-500/30"
          >
            Sign in to unlock
          </Link>
        </div>
      )}
      <div className="overflow-x-auto rounded-lg border border-slate-800">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-800 bg-slate-900/50">
              <th className="sticky left-0 z-10 min-w-[150px] bg-slate-900/50 p-3 text-left text-xs uppercase tracking-wider text-slate-500">
                Metric
              </th>
              {listings.map((l) => (
                <th key={l.id} className="min-w-[220px] p-3 text-left align-top">
                  <Link href={`/properties/${l.id}`} className="group block">
                    <div className="relative mb-2 h-28 w-full overflow-hidden rounded-md bg-slate-800">
                      {l.thumbnailUrl || l.primaryImageUrl ? (
                        <Image
                          src={l.primaryImageUrl || l.thumbnailUrl || ""}
                          alt={l.UnparsedAddress || "Listing"}
                          fill
                          className="object-cover"
                          unoptimized
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center text-xs text-slate-600">
                          No Image
                        </div>
                      )}
                    </div>
                    <p className="font-mono text-base font-bold text-emerald-400">{formatPrice(l.ListPrice)}</p>
                    <p className="text-xs leading-snug text-slate-300 group-hover:text-cyan-300">
                      {l.UnparsedAddress || l.City || "Address unavailable"}
                    </p>
                  </Link>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/70">
            {/* Deal Score — the headline read, pinned to the top of the grid */}
            <tr className="bg-slate-900/30">
              <td className="sticky left-0 z-10 bg-slate-950 p-3 text-slate-500">Deal Score</td>
              {listings.map((l, i) => {
                if (!isAuthed) {
                  return (
                    <td key={l.id} className="p-3">
                      <LockedCell />
                    </td>
                  );
                }
                const d = dealScores[i];
                const isBest = dealBest.has(i);
                return (
                  <td key={l.id} className={cn("p-3", isBest && "bg-emerald-500/5")}>
                    {d && d.score !== null ? (
                      <span className="inline-flex items-center gap-1.5">
                        <DealScoreBadge score={d.score} grade={d.grade} />
                        {isBest && <span className="text-[10px] uppercase text-emerald-500">best</span>}
                      </span>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </td>
                );
              })}
            </tr>

            {/* ── Valuation block: our estimate vs the asking price ─────────────── */}
            <tr className="hover:bg-slate-900/30">
              <td className="sticky left-0 z-10 bg-slate-950 p-3 text-slate-500">Est. Value</td>
              {listings.map((l) => {
                if (!isAuthed) {
                  return (
                    <td key={l.id} className="p-3">
                      <LockedCell />
                    </td>
                  );
                }
                const e = estOf(l);
                return (
                  <td key={l.id} className="p-3 font-mono text-slate-200">
                    {e?.estimatedValue ? (
                      <span className="inline-flex items-center gap-1.5">
                        {formatPrice(e.estimatedValue)}
                        {e.confidence && (
                          <span className="text-[10px] uppercase tracking-wide text-slate-500">
                            {e.confidence.toLowerCase()}
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-600">Insufficient comps</span>
                    )}
                  </td>
                );
              })}
            </tr>
            <tr className="hover:bg-slate-900/30">
              <td className="sticky left-0 z-10 bg-slate-950 p-3 text-slate-500">vs Estimate</td>
              {listings.map((l, i) => {
                if (!isAuthed) {
                  return (
                    <td key={l.id} className="p-3">
                      <LockedCell />
                    </td>
                  );
                }
                const d = discountValues[i];
                if (d == null) {
                  return (
                    <td key={l.id} className="p-3 text-slate-600">
                      —
                    </td>
                  );
                }
                const under = d >= 0;
                const isBest = discountBest.has(i);
                return (
                  <td key={l.id} className="p-3 font-mono">
                    <span className={cn("font-semibold", under ? "text-emerald-400" : "text-amber-400")}>
                      {`${Math.abs(d).toFixed(1)}% ${under ? "under" : "over"}`}
                    </span>
                    {isBest && <span className="ml-1.5 text-[10px] uppercase text-emerald-500">best</span>}
                  </td>
                );
              })}
            </tr>

            {/* ── Generic metric rows ──────────────────────────────────────────── */}
            {NUMERIC_METRICS.map((metric) => {
              const values = listings.map((l) => metric.get(l, estOf(l)));
              const best = winners.get(metric.label) ?? new Set<number>();
              const bv = metric.magnitude ? bestValue(values, metric.better) : null;
              return (
                <tr key={metric.label} className="hover:bg-slate-900/30">
                  <td className="sticky left-0 z-10 bg-slate-950 p-3 text-slate-500">{metric.label}</td>
                  {listings.map((l, i) => {
                    const v = values[i];
                    const isBest = best.has(i);
                    const delta =
                      metric.magnitude && bv != null && v != null && v !== bv
                        ? `${v - bv > 0 ? "+" : "−"}${metric.format(Math.abs(v - bv))}`
                        : null;
                    return (
                      <td
                        key={l.id}
                        className={cn("p-3 font-mono", isBest ? "font-bold text-emerald-400" : "text-slate-200")}
                      >
                        {v == null ? <span className="text-slate-600">—</span> : metric.format(v)}
                        {isBest && <span className="ml-1.5 text-[10px] uppercase text-emerald-500">best</span>}
                        {delta && <span className="ml-1.5 text-[10px] text-slate-500">{delta}</span>}
                      </td>
                    );
                  })}
                </tr>
              );
            })}

            {TEXT_METRICS.map((metric) => (
              <tr key={metric.label} className="hover:bg-slate-900/30">
                <td className="sticky left-0 z-10 bg-slate-950 p-3 text-slate-500">{metric.label}</td>
                {listings.map((l) => (
                  <td key={l.id} className="p-3 text-slate-200">
                    {metric.get(l)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-slate-600">
        Est. Value is the PureProperty Estimate — our own deterministic model, not an MLS/TRREB
        figure. &ldquo;vs Estimate&rdquo; compares the asking price to that estimate.
      </p>
    </div>
  );
}

function LockedCell() {
  return (
    <span className="inline-flex items-center gap-1 text-slate-500" title="Sign in to view">
      <Lock className="h-3.5 w-3.5 text-cyan-400/70" />
      <span aria-hidden="true" className="select-none blur-[2px]">•••</span>
    </span>
  );
}

function Header() {
  return (
    <div className="mb-6 flex items-center justify-between">
      <div>
        <Link
          href="/properties"
          className="mb-2 inline-flex items-center gap-1.5 text-sm text-cyan-400 transition-colors hover:text-cyan-300"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Command Center
        </Link>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-100">
          <GitCompareArrows className="h-6 w-6 text-cyan-400" />
          Compare Properties
        </h1>
      </div>
    </div>
  );
}
