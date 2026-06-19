"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, GitCompareArrows, Lock } from "lucide-react";
import type { CompareData } from "@/lib/property/getCompareData";
import {
  CORE_METRICS,
  extendedGroupMetrics,
  visibleRows,
  LENS_PRIORITY_GROUP,
  lensGroupOrder,
  type MetricContext,
} from "@/lib/compare/compareMetricsConfig";
import { useCompareAssumptions } from "@/lib/compare/useCompareAssumptions";
import AssumptionsBar from "@/components/compare/AssumptionsBar";
import MetricGroup from "@/components/compare/MetricGroup";
import MetricRow from "@/components/compare/MetricRow";
import CompareMediaCell from "@/components/compare/CompareMediaCell";
import RentInput from "@/components/compare/RentInput";
import CompareMobile from "@/components/compare/CompareMobile";
import CompareValuePlot from "@/components/compare/CompareValuePlot";
import { formatPrice, cn } from "@/lib/utils";
import type { PersonaType } from "@/lib/personas/personaConfig";

export default function CompareClient({
  listings,
  estimates,
  salePrices,
  isAuthed,
}: CompareData & { isAuthed: boolean }) {
  const [lens, setLens] = useState<PersonaType>("smart");
  const [diffOnly, setDiffOnly] = useState(false);
  // Table is the familiar default; the value plot earns its place once there are
  // enough homes to show a cluster (and only when signed in, since its value axis
  // is the members-only Estimate).
  const [view, setView] = useState<"table" | "plot">(
    () => (isAuthed && listings.length >= 6 ? "plot" : "table")
  );
  const uw = useCompareAssumptions(listings);

  const contexts: MetricContext[] = useMemo(
    () => listings.map((l) => ({
      listing: l,
      estimate: estimates[l.id],
      salePrice: salePrices[l.id],
      underwriting: uw.resultById[l.id],
      isAuthed,
    })),
    [listings, estimates, salePrices, uw.resultById, isAuthed]
  );

  if (listings.length === 0) {
    return (
      <div className="mx-auto max-w-[1400px] px-4 py-6">
        <Header />
        <div className="py-20 text-center text-slate-400">
          <p className="mb-4">No properties to compare.</p>
          <Link href="/properties" className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800">
            ← Pick properties in the Command Center
          </Link>
        </div>
      </div>
    );
  }

  const colSpan = listings.length + 1;
  const order = lensGroupOrder(lens);

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6">
      <Header />
      {!isAuthed && <AnonBanner ids={listings.map((l) => l.id)} />}

      <AssumptionsBar
        downPaymentPct={uw.downPaymentPct}
        interestRatePct={uw.interestRatePct}
        onDownPayment={uw.setDownPaymentPct}
        onInterestRate={uw.setInterestRatePct}
        lens={lens}
        onLens={setLens}
        diffOnly={diffOnly}
        onDiffToggle={setDiffOnly}
      />

      {/* View switch — side-by-side table vs value plot */}
      <div className="mb-3 mt-4 flex items-center justify-between gap-3">
        <p className="text-xs text-slate-500">
          {listings.length} {listings.length === 1 ? "home" : "homes"} ·{" "}
          {view === "plot" ? "value plot" : "side-by-side"}
        </p>
        <div className="inline-flex overflow-hidden rounded-md border border-slate-700">
          {(["table", "plot"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              aria-pressed={view === v}
              className={cn(
                "px-3 py-1.5 text-xs font-semibold transition-colors",
                view === v ? "bg-slate-800 text-slate-100" : "bg-slate-950 text-slate-400 hover:text-slate-200"
              )}
            >
              {v === "table" ? "▦ Table" : "⊹ Value plot"}
            </button>
          ))}
        </div>
      </div>

      {view === "plot" ? (
        <CompareValuePlot contexts={contexts} />
      ) : (
        <>
      {/* Desktop table */}
      <div className="hidden overflow-x-auto rounded-lg border border-slate-800 md:block">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-800 bg-slate-900/50">
              <th className="sticky left-0 z-10 min-w-[150px] bg-slate-900/50 p-3 text-left text-xs uppercase tracking-wider text-slate-500">
                Metric
              </th>
              {listings.map((l) => (
                <th key={l.id} className="min-w-[220px] p-3 text-left align-top">
                  <CompareMediaCell listing={l} />
                  <Link href={`/properties/${l.id}`} className="group block">
                    <p className="font-mono text-base font-bold text-emerald-400">{formatPrice(l.ListPrice)}</p>
                    <p className="text-xs leading-snug text-slate-300 group-hover:text-cyan-300">
                      {l.UnparsedAddress || l.City || "Address unavailable"}
                    </p>
                  </Link>
                  <RentInput
                    value={uw.rentById[l.id]}
                    seeded={uw.seededRentById[l.id] ?? 0}
                    onChange={(v) => uw.setRent(l.id, v)}
                  />
                </th>
              ))}
            </tr>
          </thead>
          {/* Core comparison — the original always-visible rows, shown flat */}
          <tbody className="divide-y divide-slate-800/70 border-b-4 border-slate-950">
            {visibleRows(CORE_METRICS, contexts, diffOnly).map(({ metric, resolved }) => (
              <MetricRow key={metric.key} metric={metric} contexts={contexts} resolved={resolved} />
            ))}
          </tbody>

          {/* Additional metrics — collapsible, lens-ordered groups */}
          {order
            .filter((groupId) => extendedGroupMetrics(groupId).length > 0)
            .map((groupId) => (
              <MetricGroup
                key={`${lens}-${groupId}`}
                groupId={groupId}
                metrics={extendedGroupMetrics(groupId)}
                contexts={contexts}
                colSpan={colSpan}
                defaultOpen={groupId === LENS_PRIORITY_GROUP[lens]}
                diffOnly={diffOnly}
              />
            ))}
        </table>
      </div>

      {/* Mobile */}
      <CompareMobile
        listings={listings}
        contexts={contexts}
        lens={lens}
        diffOnly={diffOnly}
        rentById={uw.rentById}
        seededRentById={uw.seededRentById}
        onRent={uw.setRent}
      />
        </>
      )}

      <p className="mt-3 text-[11px] leading-relaxed text-slate-600">
        Est. Sale Price is our list-anchored model of what this home is likely to close at; vs Comp
        Value compares the ask to recent comparable sales. Our own deterministic models, not MLS/TRREB
        figures. Carry, cap rate &amp; cashflow are computed from your assumptions and a rent estimate,
        not advice.
      </p>
    </div>
  );
}

function AnonBanner({ ids }: { ids: string[] }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-cyan-500/30 bg-cyan-500/5 px-4 py-2.5">
      <p className="text-xs text-slate-300">
        <Lock className="mr-1.5 inline h-3.5 w-3.5 text-cyan-400" />
        Estimates, deal scores &amp; sold-derived metrics are members-only.
      </p>
      <Link
        href={`/login?next=${encodeURIComponent(`/properties/compare?ids=${ids.join(",")}`)}`}
        className="inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-md border border-cyan-400/50 bg-cyan-500/20 px-4 py-3 text-sm font-semibold text-cyan-100 transition-colors hover:bg-cyan-500/30 active:scale-95"
      >
        Unlock deal scores + AVM estimates — free
      </Link>
    </div>
  );
}

function Header() {
  return (
    <div className="mb-6 flex items-center justify-between">
      <div>
        <Link href="/properties" className="mb-2 inline-flex items-center gap-1.5 text-sm text-cyan-400 transition-colors hover:text-cyan-300">
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
