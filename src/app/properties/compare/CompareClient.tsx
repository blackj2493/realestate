"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, GitCompareArrows } from "lucide-react";
import { cn, formatPrice } from "@/lib/utils";
import { searchListings, type ListingDocument } from "@/lib/typesense/client";
import { dealScoreFromDocument } from "@/lib/dealScore/fromListingDocument";
import { DealScoreBadge } from "@/components/Property/DealScoreCard";

type Better = "high" | "low" | null;

interface NumericMetric {
  label: string;
  get: (l: ListingDocument) => number | null;
  format: (v: number) => string;
  better: Better;
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

const NUMERIC_METRICS: NumericMetric[] = [
  { label: "List Price", get: (l) => l.ListPrice ?? null, format: formatPrice, better: "low" },
  {
    label: "Price / Sqft",
    get: (l) => (l.BuildingAreaTotal && l.BuildingAreaTotal > 0 ? l.ListPrice / l.BuildingAreaTotal : null),
    format: (v) => `$${Math.round(v).toLocaleString()}`,
    better: "low",
  },
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

export default function CompareClient({ ids }: { ids: string[] }) {
  const [listings, setListings] = useState<ListingDocument[] | null>(null);

  useEffect(() => {
    if (ids.length === 0) {
      setListings([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await searchListings({
          query: "*",
          rawFilterBy: `id:[${ids.join(",")}]`,
          perPage: ids.length,
        });
        if (cancelled) return;
        // Preserve the order the user selected them in.
        const byId = new Map(res.listings.map((l) => [l.id, l]));
        setListings(ids.map((id) => byId.get(id)).filter(Boolean) as ListingDocument[]);
      } catch {
        if (!cancelled) setListings([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ids]);

  const winners = useMemo(() => {
    if (!listings) return new Map<string, Set<number>>();
    const m = new Map<string, Set<number>>();
    for (const metric of NUMERIC_METRICS) {
      m.set(metric.label, bestIndices(listings.map(metric.get), metric.better));
    }
    return m;
  }, [listings]);

  const dealScores = useMemo(
    () => (listings ? listings.map((l) => dealScoreFromDocument(l)) : []),
    [listings]
  );
  const dealBest = useMemo(
    () => bestIndices(dealScores.map((d) => d.score), "high"),
    [dealScores]
  );

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6">
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

      {listings === null ? (
        <div className="py-20 text-center text-slate-500">Loading comparison…</div>
      ) : listings.length === 0 ? (
        <div className="py-20 text-center text-slate-400">
          <p className="mb-4">No properties to compare.</p>
          <Link
            href="/properties"
            className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
          >
            ← Pick properties in the Command Center
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-800">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-900/50">
                <th className="sticky left-0 z-10 min-w-[140px] bg-slate-900/50 p-3 text-left text-xs uppercase tracking-wider text-slate-500">
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
                      <p className="font-mono text-base font-bold text-emerald-400">
                        {formatPrice(l.ListPrice)}
                      </p>
                      <p className="text-xs leading-snug text-slate-300 group-hover:text-cyan-300">
                        {l.UnparsedAddress || l.City || "Address unavailable"}
                      </p>
                    </Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {/* Deal Score — the headline verdict, pinned to the top of the grid */}
              <tr className="bg-slate-900/30">
                <td className="sticky left-0 z-10 bg-slate-950 p-3 text-slate-500">Deal Score</td>
                {listings.map((l, i) => {
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
              {NUMERIC_METRICS.map((metric) => {
                const best = winners.get(metric.label) ?? new Set<number>();
                return (
                  <tr key={metric.label} className="hover:bg-slate-900/30">
                    <td className="sticky left-0 z-10 bg-slate-950 p-3 text-slate-500">{metric.label}</td>
                    {listings.map((l, i) => {
                      const v = metric.get(l);
                      const isBest = best.has(i);
                      return (
                        <td
                          key={l.id}
                          className={cn(
                            "p-3 font-mono",
                            isBest ? "font-bold text-emerald-400" : "text-slate-200"
                          )}
                        >
                          {v == null ? <span className="text-slate-600">—</span> : metric.format(v)}
                          {isBest && <span className="ml-1.5 text-[10px] uppercase text-emerald-500">best</span>}
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
      )}
    </div>
  );
}
