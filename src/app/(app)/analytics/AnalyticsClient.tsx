"use client";

/**
 * Market Trends terminal — the real replacement for the old hardcoded analytics
 * placeholder. One region + property-type scope drives two cached endpoints
 * (/api/market/price-trend, /api/market/region-stats); every figure on screen is
 * a deterministic full-population aggregate (§4 — no LLM, no sampling).
 *
 * Scope is mirrored into the URL (?region=&types=) so a view is shareable and
 * survives refresh. Statistics, not listing rows, are displayed — the §6.3b
 * 100-listing cap does not apply — and the §6.3(i)/(k) consumer notice is kept.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useChartTheme } from "@/lib/theme/useChartTheme";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import LocationSearch from "@/components/CommandCenter/LocationSearch";
import {
  assembleRegionScore,
  type PriceTrendResp,
  type RegionScore,
  type RegionStatsResp,
} from "@/lib/dashboard/marketAggregates";
import { PROPERTY_TYPE_OPTIONS } from "@/lib/dashboard/propertyTypes";

const DEFAULT_REGION = "Brampton";

/** True-DoM distribution (from /api/market/dom-distribution — migration 056 RPC). */
export interface DomDistData {
  activeCount: number;
  medianTrueDom: number | null;
  medianNaiveDom: number | null; // days since OriginalEntryTimestamp (resets on relist)
  p25: number | null;
  p75: number | null;
  stalePct: number | null; // 0..1, share with true_dom >= 61 (60d+ stale line)
  buckets: { d0_14: number; d15_30: number; d31_60: number; d61_90: number; d90plus: number };
}
export interface DomDistResp {
  region: string;
  dom: DomDistData;
  locked?: boolean;
  error?: string;
}

/** Price-cut pressure response (from /api/market/price-cuts — migration 058 RPC). */
export interface PriceCutsData {
  activeCount: number;
  cutCount: number;
  cutShare: number | null; // 0..1
  medianCutAmt: number | null; // median $ reduction among cut listings
  medianCutPct: number | null; // median % reduction among cut listings
}
export interface PriceCutsResp {
  region: string;
  cuts: PriceCutsData;
  locked?: boolean;
  error?: string;
}

/** Sold-side dynamics (from /api/market/sold-dynamics — migration 061 RPC). */
export interface SoldDynamicsData {
  soldCount: number;
  medianDom: number | null;
  p25Dom: number | null;
  p75Dom: number | null;
  medianPpsf: number | null;
  p25Ppsf: number | null;
  p75Ppsf: number | null;
  ppsfSample: number;
  askGapMedian: number | null; // % (close − original ask)/original ask; negative = under ask
  askGapSample: number;
  underAskShare: number | null; // 0..1
}
export interface SoldDynamicsResp {
  region: string;
  dynamics: SoldDynamicsData;
  locked?: boolean;
  error?: string;
}

/** Rent & gross yield by bedroom (from /api/market/rental-yield — migration 062 RPC). */
export interface RentalYieldRowData {
  beds: number;
  typicalRent: number | null;
  rentSample: number;
  medianPrice: number | null;
  priceSample: number;
  grossYieldPct: number | null;
}
export interface RentalYieldResp {
  region: string;
  rental: { rows: RentalYieldRowData[] };
  locked?: boolean;
  error?: string;
}

/** AVM estimate confidence (from /api/market/avm-reliability — migration 062 RPC). */
export interface AvmReliabilityData {
  cohortCount: number;
  salesAnalyzed: number;
  wavgR2: number | null;
  wavgMaePct: number | null;
}
export interface AvmReliabilityResp {
  region: string;
  avm: AvmReliabilityData;
  locked?: boolean;
  error?: string;
}

/** Daily active-inventory snapshots (from /api/market/inventory-history — migration 064). */
export interface InventoryPointData {
  date: string; // YYYY-MM-DD
  activeCount: number | null;
  stalePct: number | null; // 0..1
  medianCapRate: number | null;
}
export interface InventoryHistoryResp {
  region: string;
  inventory: { points: InventoryPointData[] };
  locked?: boolean;
  error?: string;
}

/** Monthly seasonality (from /api/market/seasonality — migration 065 RPC). */
export interface SeasonMonthData {
  month: number; // 1..12
  sales: number;
  priceIndexPct: number | null;
  soldToList: number | null;
}
export interface SeasonalityResp {
  region: string;
  seasonality: { months: SeasonMonthData[] };
  locked?: boolean;
  error?: string;
}

/** Sell-through / withdrawal outcomes (from /api/market/listing-outcomes — migration 066). */
export interface ListingOutcomesData {
  windowMonths: number;
  soldCount: number;
  failedCount: number;
  failureRate: number | null; // 0..1
  medianFailedDom: number | null;
}
export interface ListingOutcomesResp {
  region: string;
  outcomes: ListingOutcomesData;
  locked?: boolean;
  error?: string;
}

/** Multi-cut price-ledger activity (from /api/market/price-ledger — migrations 069/070). */
export interface PriceLedgerData {
  cutEvents: number;
  cutProperties: number;
  medianCutPct: number | null;
  medianCutAmt: number | null;
  multiCutProperties: number;
}
export interface PriceLedgerResp {
  region: string;
  ledger: PriceLedgerData;
  locked?: boolean;
  error?: string;
}

/** Server-prefetched initial scope + payloads (from analytics/page.tsx). */
export interface AnalyticsInitial {
  region: string;
  typeKeys: string[];
  trend: PriceTrendResp | null;
  stats: RegionStatsResp | null;
  dom: DomDistResp | null;
  cuts: PriceCutsResp | null;
  dynamics: SoldDynamicsResp | null;
  rental: RentalYieldResp | null;
  avm: AvmReliabilityResp | null;
  inventory: InventoryHistoryResp | null;
  seasonality: SeasonalityResp | null;
  outcomes: ListingOutcomesResp | null;
  ledger: PriceLedgerResp | null;
}

const makeScopeKey = (region: string, typeKeys: string[]) =>
  `${region}|${[...typeKeys].sort().join(",")}`;

type Metric = "price" | "ppsf" | "sales" | "s2l";

const METRIC_TABS: [Metric, string][] = [
  ["price", "Median Price"],
  ["ppsf", "$ / Sqft"],
  ["sales", "Sales Volume"],
  ["s2l", "Sold / List"],
];

function shortMonth(key: string): string {
  const [y, m] = key.split("-");
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const idx = Number(m) - 1;
  return idx >= 0 && idx < 12 ? `${names[idx]} '${y.slice(2)}` : key;
}

const fmtPrice = (v: number) =>
  v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(2)}M` : `$${Math.round(v / 1000)}K`;

function fmtFull(v: number | null): string {
  return v == null ? "—" : `$${Math.round(v).toLocaleString()}`;
}

function YoYBadge({ pct }: { pct: number | null }) {
  if (pct == null) return null;
  return (
    <span
      className={`terminal-font text-xs font-bold uppercase tracking-wider ${
        pct >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400"
      }`}
    >
      {pct >= 0 ? "▲" : "▼"} {Math.abs(pct).toFixed(1)}% YoY
    </span>
  );
}

const TEMP_STYLE: Record<NonNullable<RegionScore["temperature"]>, { label: string; cls: string }> = {
  hot: { label: "Seller's Market", cls: "bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/40" },
  balanced: { label: "Balanced", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/40" },
  cold: { label: "Buyer's Market", cls: "bg-sky-500/15 text-sky-700 dark:text-sky-400 border-sky-500/40" },
};

interface KpiProps {
  label: string;
  value: string;
  sub?: React.ReactNode;
  loading: boolean;
}

function KpiCard({ label, value, sub, loading }: KpiProps) {
  return (
    <div className="border border-border bg-card/40 px-4 py-3">
      <p className="terminal-font text-xs font-bold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      {loading ? (
        <div className="mt-2 h-7 w-24 animate-pulse bg-muted/60" />
      ) : (
        <p className="mt-1 font-mono text-xl font-bold text-foreground">{value}</p>
      )}
      <div className="mt-1 min-h-[16px] text-xs text-muted-foreground">{!loading && sub}</div>
    </div>
  );
}

// True-DoM aging buckets — sequential cyan ramp, monotonic lightness in BOTH themes
// (light: fresh→light, older→dark · dark: inverted) so "older" always reads as the
// stronger step. The 60d stale line is drawn separately (rose).
const AGE = [
  { key: "d0_14",  label: "0–14d",  cls: "bg-cyan-200 dark:bg-cyan-900" },
  { key: "d15_30", label: "15–30d", cls: "bg-cyan-400 dark:bg-cyan-700" },
  { key: "d31_60", label: "31–60d", cls: "bg-cyan-500 dark:bg-cyan-600" },
  { key: "d61_90", label: "61–90d", cls: "bg-cyan-600 dark:bg-cyan-500" },
  { key: "d90plus", label: "90d+",  cls: "bg-cyan-700 dark:bg-cyan-300" },
] as const;

/** Tier-1 "True Days on Market" panel — median hero + IQR distribution + hidden gap + aging + 60d stale. */
function TrueDomPanel({ dom, loading }: { dom: DomDistData | null; loading: boolean }) {
  const active = dom?.activeCount ?? 0;
  const b = dom?.buckets;
  const pct = (n: number) => (active > 0 ? (n / active) * 100 : 0);
  const staleLineLeft = b ? pct(b.d0_14 + b.d15_30 + b.d31_60) : 0;
  const mt = dom?.medianTrueDom ?? null;
  const mn = dom?.medianNaiveDom ?? null;
  const gapMult = mt != null && mn != null && mn > 0 ? mt / mn : null;
  const p25 = dom?.p25 ?? 0;
  const p75 = dom?.p75 ?? 0;
  const scaleMax = Math.max(90, Math.ceil(((p75 || 60) * 1.25) / 30) * 30);
  const at = (v: number) => `${Math.min(100, Math.max(0, (v / scaleMax) * 100))}%`;

  return (
    <div className="mt-5 border border-border bg-card/40 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="terminal-font text-[11px] font-bold uppercase tracking-wider text-foreground">
          True Days on Market
        </h2>
        <span className="terminal-font rounded-sm bg-cyan-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-cyan-700 dark:text-cyan-300">
          New
        </span>
        <span className="text-[11px] text-muted-foreground">relist-aware · stitches terminate→relist chains</span>
      </div>

      {loading ? (
        <div className="mt-4 h-40 w-full animate-pulse bg-muted/40" />
      ) : active === 0 ? (
        <p className="mt-4 text-xs text-muted-foreground">No active inventory for this scope</p>
      ) : (
        <>
          <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(130px,0.75fr)_1.5fr_minmax(150px,0.9fr)]">
            {/* hero median */}
            <div className="self-center">
              <div className="font-mono text-5xl font-bold leading-none text-cyan-700 dark:text-cyan-300">
                {mt ?? "—"}
                <span className="ml-1 text-xl text-muted-foreground">d</span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">median true days on market</p>
            </div>

            {/* IQR distribution bar */}
            <div className="self-center">
              <div className="mb-2 flex justify-between font-mono text-[10px] text-muted-foreground">
                <span>0d</span>
                <span className="text-muted-foreground/80">middle 50% of active inventory</span>
                <span>{scaleMax}d+</span>
              </div>
              <div className="relative h-12">
                <div className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-border" />
                <div
                  className="absolute top-1/2 h-5 -translate-y-1/2 rounded-sm border border-cyan-600/70 bg-cyan-500/15 dark:border-cyan-400/50"
                  style={{ left: at(p25), right: `calc(100% - ${at(p75)})` }}
                />
                <div
                  className="absolute top-1/2 h-8 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-sm bg-cyan-600 dark:bg-cyan-300"
                  style={{ left: at(mt ?? 0) }}
                />
                <span className="absolute top-0 -translate-x-1/2 font-mono text-[10px] text-muted-foreground" style={{ left: at(p25) }}>{p25}</span>
                <span className="absolute top-0 -translate-x-1/2 font-mono text-[10px] font-bold text-cyan-700 dark:text-cyan-300" style={{ left: at(mt ?? 0) }}>{mt}</span>
                <span className="absolute top-0 -translate-x-1/2 font-mono text-[10px] text-muted-foreground" style={{ left: at(p75) }}>{p75}</span>
                <span className="absolute bottom-0 -translate-x-1/2 text-[9px] text-muted-foreground" style={{ left: at(p25) }}>p25</span>
                <span className="absolute bottom-0 -translate-x-1/2 text-[9px] font-semibold text-cyan-700 dark:text-cyan-300" style={{ left: at(mt ?? 0) }}>median</span>
                <span className="absolute bottom-0 -translate-x-1/2 text-[9px] text-muted-foreground" style={{ left: at(p75) }}>p75</span>
              </div>
            </div>

            {/* hidden DoM gap — self-gated dual bars */}
            {mn != null && gapMult != null && gapMult >= 1.15 ? (
              <div className="self-center rounded-sm border border-border bg-background/40 px-3 py-2.5">
                <div className="terminal-font text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Hidden DoM gap
                </div>
                <div className="mt-2 space-y-1.5">
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className="w-9 shrink-0 text-muted-foreground">True</span>
                    <span className="h-2.5 rounded-r-sm bg-cyan-600 dark:bg-cyan-400" style={{ width: "100%" }} />
                    <span className="shrink-0 font-mono font-semibold text-foreground">{mt}d</span>
                  </div>
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className="w-9 shrink-0 text-muted-foreground">MLS #</span>
                    <span
                      className="h-2.5 rounded-r-sm bg-muted-foreground/40"
                      style={{ width: `${Math.max(4, (mn / (mt || 1)) * 100)}%` }}
                    />
                    <span className="shrink-0 font-mono font-semibold text-foreground">{mn}d</span>
                  </div>
                </div>
                <p className="mt-2 font-mono text-[11px] font-bold text-cyan-700 dark:text-cyan-300">
                  {gapMult.toFixed(1)}× longer than the feed shows
                </p>
              </div>
            ) : mn != null ? (
              <div className="self-center rounded-sm border border-border bg-background/40 px-3 py-2.5 text-[11px] text-muted-foreground">
                <div className="terminal-font text-[10px] font-bold uppercase tracking-wider">Feed DoM</div>
                <div className="mt-1.5 font-mono text-foreground">MLS # median {mn}d</div>
                <p className="mt-1 leading-tight">near parity with true DoM here — few relists in this scope</p>
              </div>
            ) : null}
          </div>

          {/* aging curve */}
          <div className="mt-7">
            <div className="terminal-font mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Inventory aging · share of active by true DoM
            </div>
            <div className="relative">
              <div className="flex h-8 gap-[2px] overflow-hidden rounded-sm">
                {AGE.map((a) => {
                  const w = pct(b![a.key]);
                  return w > 0 ? (
                    <div key={a.key} className={a.cls} style={{ width: `${w}%` }} title={`${a.label} · ${Math.round(w)}%`} />
                  ) : null;
                })}
              </div>
              {staleLineLeft > 1 && staleLineLeft < 99 && (
                <div className="absolute -top-1 w-0 border-l-2 border-dashed border-rose-500" style={{ left: `${staleLineLeft}%`, bottom: "-16px" }}>
                  <span className="absolute -top-3 left-1 whitespace-nowrap bg-card px-1 text-[9px] font-bold text-rose-600 dark:text-rose-400">
                    60d stale
                  </span>
                </div>
              )}
            </div>
            <div className="mt-7 flex flex-wrap gap-x-4 gap-y-1">
              {AGE.map((a) => (
                <span key={a.key} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className={`inline-block h-2.5 w-2.5 rounded-[2px] ${a.cls}`} />
                  <span className="font-mono">
                    {a.label} · {Math.round(pct(b![a.key]))}%
                  </span>
                </span>
              ))}
            </div>
          </div>

          {/* stale callout */}
          <div className="mt-4 flex items-baseline gap-2 border-t border-border pt-3">
            <span className="font-mono text-2xl font-bold text-rose-600 dark:text-rose-400">
              {dom!.stalePct != null ? `${Math.round(dom!.stalePct * 100)}%` : "—"}
            </span>
            <span className="text-xs text-muted-foreground">
              stale — past the 60d+ line; inventory the seller can’t move
            </span>
          </div>
        </>
      )}

      <p className="terminal-font mt-3 text-[10px] text-muted-foreground">
        source · relist-stitched TrueDom · across {active.toLocaleString()} active listings
      </p>
    </div>
  );
}

/** Tier-1 "Price-cut pressure" panel — share of active reduced + median $ / % cut depth. */
function PriceCutPanel({ cuts, loading }: { cuts: PriceCutsData | null; loading: boolean }) {
  const active = cuts?.activeCount ?? 0;
  const share = cuts?.cutShare ?? null;
  const sharePct = share != null ? Math.round(share * 100) : 0;
  return (
    <div className="mt-5 border border-border bg-card/40 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="terminal-font text-[11px] font-bold uppercase tracking-wider text-foreground">
          Price-Cut Pressure
        </h2>
        <span className="terminal-font rounded-sm bg-cyan-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-cyan-700 dark:text-cyan-300">
          New
        </span>
        <span className="text-[11px] text-muted-foreground">active listings that have reduced their ask</span>
      </div>

      {loading ? (
        <div className="mt-4 h-16 w-full animate-pulse bg-muted/40" />
      ) : active === 0 ? (
        <p className="mt-4 text-xs text-muted-foreground">No active inventory for this scope</p>
      ) : (
        <div className="mt-4 grid gap-6 sm:grid-cols-[1.3fr_1fr]">
          <div>
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-4xl font-bold text-foreground">
                {share != null ? `${sharePct}%` : "—"}
              </span>
              <span className="text-xs text-muted-foreground">of active listings have cut their price</span>
            </div>
            <div className="mt-3 h-3 w-full overflow-hidden rounded-sm bg-muted/50">
              <div
                className="h-full rounded-sm bg-gradient-to-r from-cyan-500 to-rose-500"
                style={{ width: `${sharePct}%` }}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 self-center">
            <div>
              <div className="font-mono text-2xl font-bold text-rose-600 dark:text-rose-400">
                {cuts!.medianCutPct != null ? `−${cuts!.medianCutPct.toFixed(1)}%` : "—"}
              </div>
              <div className="text-[11px] text-muted-foreground">median cut depth</div>
            </div>
            <div>
              <div className="font-mono text-2xl font-bold text-rose-600 dark:text-rose-400">
                {cuts!.medianCutAmt != null ? `−${fmtPrice(cuts!.medianCutAmt)}` : "—"}
              </div>
              <div className="text-[11px] text-muted-foreground">median $ reduction</div>
            </div>
          </div>
        </div>
      )}

      <p className="terminal-font mt-3 text-[10px] text-muted-foreground">
        source · relist-stitched TotalPriceDrop · {(cuts?.cutCount ?? 0).toLocaleString()} of{" "}
        {active.toLocaleString()} active reduced
      </p>
    </div>
  );
}

/** Tier-1 "Absorption & sell-through" panel — donut + sold velocity, derived from months-of-supply. */
function AbsorptionPanel({
  monthsSupply,
  monthlyVelocity,
  loading,
}: {
  monthsSupply: number | null;
  monthlyVelocity: number | null;
  loading: boolean;
}) {
  const absorption = monthsSupply != null && monthsSupply > 0 ? 1 / monthsSupply : null;
  const absPct = absorption != null ? Math.round(absorption * 100) : null;
  const C = 2 * Math.PI * 50; // r=50 circumference
  const dash = C * (1 - (absorption != null ? Math.min(1, absorption) : 0));
  return (
    <div className="mt-5 border border-border bg-card/40 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="terminal-font text-[11px] font-bold uppercase tracking-wider text-foreground">
          Absorption &amp; Sell-Through
        </h2>
        <span className="terminal-font rounded-sm bg-cyan-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-cyan-700 dark:text-cyan-300">
          New
        </span>
        <span className="text-[11px] text-muted-foreground">how fast this market clears its inventory</span>
      </div>

      {loading ? (
        <div className="mt-4 h-28 w-full animate-pulse bg-muted/40" />
      ) : absorption == null ? (
        <p className="mt-4 text-xs text-muted-foreground">Not enough sold data for this scope</p>
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-6">
          <div className="relative h-28 w-28 shrink-0">
            <svg viewBox="0 0 120 120" className="h-28 w-28 -rotate-90">
              <circle cx="60" cy="60" r="50" fill="none" strokeWidth="12" className="stroke-muted/30" />
              <circle
                cx="60"
                cy="60"
                r="50"
                fill="none"
                strokeWidth="12"
                strokeLinecap="round"
                className="stroke-cyan-600 dark:stroke-cyan-400"
                strokeDasharray={C}
                strokeDashoffset={dash}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="font-mono text-2xl font-bold text-cyan-700 dark:text-cyan-300">{absPct}%</span>
              <span className="text-[10px] text-muted-foreground">per month</span>
            </div>
          </div>
          <div className="min-w-[180px] flex-1 space-y-2 text-xs">
            <div className="flex items-baseline justify-between gap-3 border-b border-border pb-2">
              <span className="text-muted-foreground">Sold / month</span>
              <span className="font-mono text-base font-semibold text-foreground">
                {monthlyVelocity != null ? Math.round(monthlyVelocity).toLocaleString() : "—"}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-3 border-b border-border pb-2">
              <span className="text-muted-foreground">Months to clear</span>
              <span className="font-mono text-base font-semibold text-foreground">{monthsSupply!.toFixed(1)}</span>
            </div>
            <p className="pt-1 text-muted-foreground">
              At the current sold pace, this market absorbs{" "}
              <span className="font-mono text-foreground">{absPct}%</span> of its active inventory each month —
              clearing the pool in <span className="font-mono text-foreground">{monthsSupply!.toFixed(1)}</span> months.
            </p>
          </div>
        </div>
      )}

      <p className="terminal-font mt-3 text-[10px] text-muted-foreground">
        source · active inventory ÷ 6-month settled sold velocity
      </p>
    </div>
  );
}

// ── Market momentum (derived — no fetch; from the monthly sold-trend points) ──────────
interface MomentumPt { medianPrice?: number | null; sales?: number | null; soldToList?: number | null }
interface Momentum {
  pricePct: number | null;
  salesPct: number | null;
  s2lDeltaPp: number | null;
  label: "Heating up" | "Cooling" | "Steady" | null;
}
function computeMomentum(points: MomentumPt[]): Momentum {
  const settled = points.slice(0, -1); // drop the current, still-accruing month
  const avg = (arr: MomentumPt[], key: keyof MomentumPt) => {
    const vals = arr
      .map((p) => p[key])
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  if (settled.length < 6) return { pricePct: null, salesPct: null, s2lDeltaPp: null, label: null };
  const recent = settled.slice(-3);
  const prior = settled.slice(-6, -3);
  const rP = avg(recent, "medianPrice"), pP = avg(prior, "medianPrice");
  const rS = avg(recent, "sales"), pS = avg(prior, "sales");
  const rL = avg(recent, "soldToList"), pL = avg(prior, "soldToList");
  const pricePct = rP != null && pP != null && pP > 0 ? ((rP - pP) / pP) * 100 : null;
  const salesPct = rS != null && pS != null && pS > 0 ? ((rS - pS) / pS) * 100 : null;
  const s2lDeltaPp = rL != null && pL != null ? rL - pL : null;
  let label: Momentum["label"] = null;
  if (pricePct != null || s2lDeltaPp != null) {
    const up = (pricePct ?? 0) > 1 || (s2lDeltaPp ?? 0) > 0.5;
    const down = (pricePct ?? 0) < -1 || (s2lDeltaPp ?? 0) < -0.5;
    label = up && !down ? "Heating up" : down && !up ? "Cooling" : "Steady";
  }
  return { pricePct, salesPct, s2lDeltaPp, label };
}

function MomentumStat({ label, value, unit }: { label: string; value: number | null; unit: string }) {
  const has = value != null;
  const up = (value ?? 0) >= 0;
  return (
    <div>
      <p className="terminal-font text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
      <div
        className={`mt-1 font-mono text-2xl font-bold ${
          !has ? "text-muted-foreground" : up ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400"
        }`}
      >
        {has ? `${up ? "▲" : "▼"} ${Math.abs(value!).toFixed(1)}${unit}` : "—"}
      </div>
    </div>
  );
}

/** Phase-2 "Market Momentum" — 3-mo vs prior-3-mo deltas, derived from the trend points. */
function MomentumPanel({ points, loading }: { points: MomentumPt[]; loading: boolean }) {
  const m = useMemo(() => computeMomentum(points), [points]);
  const chip =
    m.label === "Heating up"
      ? "bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/40"
      : m.label === "Cooling"
        ? "bg-sky-500/15 text-sky-700 dark:text-sky-400 border-sky-500/40"
        : "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/40";
  return (
    <div className="mt-5 border border-border bg-card/40 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="terminal-font text-[11px] font-bold uppercase tracking-wider text-foreground">
          Market Momentum
        </h2>
        <span className="terminal-font rounded-sm bg-cyan-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-cyan-700 dark:text-cyan-300">
          New
        </span>
        <span className="text-[11px] text-muted-foreground">last 3 months vs the prior 3 — is this market accelerating?</span>
        {!loading && m.label && (
          <span className={`terminal-font ml-auto border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${chip}`}>
            {m.label}
          </span>
        )}
      </div>

      {loading ? (
        <div className="mt-4 h-14 w-full animate-pulse bg-muted/40" />
      ) : m.pricePct == null && m.salesPct == null && m.s2lDeltaPp == null ? (
        <p className="mt-4 text-xs text-muted-foreground">Not enough monthly history for this scope</p>
      ) : (
        <div className="mt-4 grid grid-cols-3 gap-4">
          <MomentumStat label="Median price" value={m.pricePct} unit="%" />
          <MomentumStat label="Sales pace" value={m.salesPct} unit="%" />
          <MomentumStat label="Sold-to-list" value={m.s2lDeltaPp} unit="pp" />
        </div>
      )}

      <p className="terminal-font mt-3 text-[10px] text-muted-foreground">
        source · 3-mo vs prior 3-mo averages · current partial month excluded
      </p>
    </div>
  );
}

/** Compact p25–median–p75 range bar for the sold-dynamics blocks. */
function RangeBar({ p25, median, p75, lo, hi }: { p25: number | null; median: number | null; p75: number | null; lo: number; hi: number }) {
  if (p25 == null || p75 == null || hi <= lo) return null;
  const at = (v: number) => `${Math.min(100, Math.max(0, ((v - lo) / (hi - lo)) * 100))}%`;
  return (
    <div className="relative mt-3 h-5">
      <div className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-border" />
      <div
        className="absolute top-1/2 h-3 -translate-y-1/2 rounded-sm border border-cyan-600/70 bg-cyan-500/15 dark:border-cyan-400/50"
        style={{ left: at(p25), right: `calc(100% - ${at(p75)})` }}
      />
      {median != null && (
        <div
          className="absolute top-1/2 h-5 w-[2px] -translate-x-1/2 -translate-y-1/2 rounded-sm bg-cyan-600 dark:bg-cyan-300"
          style={{ left: at(median) }}
        />
      )}
    </div>
  );
}

/** Phase-2 "Sold-Side Dynamics" — time-to-sell + original-ask gap + $/sqft dispersion. */
function SoldDynamicsPanel({ d, loading }: { d: SoldDynamicsData | null; loading: boolean }) {
  const sold = d?.soldCount ?? 0;
  const gap = d?.askGapMedian ?? null;
  const under = d?.underAskShare ?? null;
  const domHi = Math.max(60, Math.ceil((((d?.p75Dom ?? 60) * 1.25) || 60) / 15) * 15);
  const ppsfLo = d?.p25Ppsf != null ? Math.floor((d.p25Ppsf * 0.85) / 10) * 10 : 0;
  const ppsfHi = d?.p75Ppsf != null ? Math.ceil((d.p75Ppsf * 1.15) / 10) * 10 : 0;
  return (
    <div className="mt-5 border border-border bg-card/40 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="terminal-font text-[11px] font-bold uppercase tracking-wider text-foreground">
          Sold-Side Dynamics
        </h2>
        <span className="terminal-font rounded-sm bg-cyan-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-cyan-700 dark:text-cyan-300">
          New
        </span>
        <span className="text-[11px] text-muted-foreground">how the market actually clears — trailing 12 months</span>
      </div>

      {loading ? (
        <div className="mt-4 h-28 w-full animate-pulse bg-muted/40" />
      ) : sold === 0 ? (
        <p className="mt-4 text-xs text-muted-foreground">No recent sold data for this scope</p>
      ) : (
        <div className="mt-4 grid gap-6 md:grid-cols-3">
          {/* time-to-sell */}
          <div className="md:border-r md:border-border md:pr-6">
            <div className="font-mono text-4xl font-bold leading-none text-cyan-700 dark:text-cyan-300">
              {d!.medianDom ?? "—"}
              <span className="ml-1 text-lg text-muted-foreground">d</span>
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">median days to sell</p>
            <RangeBar p25={d!.p25Dom} median={d!.medianDom} p75={d!.p75Dom} lo={0} hi={domHi} />
            <p className="mt-2 font-mono text-[11px] text-muted-foreground">
              half sell in {d!.p25Dom ?? "—"}–{d!.p75Dom ?? "—"} days
            </p>
          </div>

          {/* sold vs original ask */}
          <div className="md:border-r md:border-border md:pr-6">
            <div
              className={`font-mono text-4xl font-bold leading-none ${
                gap == null ? "text-muted-foreground" : gap < 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-700 dark:text-emerald-400"
              }`}
            >
              {gap == null ? "—" : `${gap > 0 ? "+" : ""}${gap.toFixed(1)}%`}
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">median sold vs original ask</p>
            <div className="mt-3 h-3 w-full overflow-hidden rounded-sm bg-muted/50">
              <div
                className="h-full rounded-sm bg-rose-500/70"
                style={{ width: `${under != null ? Math.round(under * 100) : 0}%` }}
              />
            </div>
            <p className="mt-2 font-mono text-[11px] text-muted-foreground">
              {under != null ? `${Math.round(under * 100)}% sold below their first ask` : "—"}
            </p>
          </div>

          {/* $/sqft dispersion */}
          <div>
            <div className="font-mono text-4xl font-bold leading-none text-foreground">
              {d!.medianPpsf != null ? `$${d!.medianPpsf}` : "—"}
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">median sold $/sqft</p>
            <RangeBar p25={d!.p25Ppsf} median={d!.medianPpsf} p75={d!.p75Ppsf} lo={ppsfLo} hi={ppsfHi} />
            <p className="mt-2 font-mono text-[11px] text-muted-foreground">
              middle 50%: ${d!.p25Ppsf ?? "—"}–${d!.p75Ppsf ?? "—"}/sqft
            </p>
          </div>
        </div>
      )}

      <p className="terminal-font mt-3 text-[10px] text-muted-foreground">
        source · {sold.toLocaleString()} sold · board DaysOnMarket · OriginalListPrice · close $psf
      </p>
    </div>
  );
}

/** Phase-2 "Rent & Gross Yield" — per-bedroom typical rent + gross yield bars. */
function RentalYieldPanel({ rows, loading }: { rows: RentalYieldRowData[]; loading: boolean }) {
  const withYield = rows.filter((r) => r.grossYieldPct != null);
  const maxYield = Math.max(6, ...withYield.map((r) => r.grossYieldPct ?? 0));
  const fmtRent = (v: number | null) => (v == null ? "—" : `$${Math.round(v).toLocaleString()}`);
  return (
    <div className="mt-5 border border-border bg-card/40 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="terminal-font text-[11px] font-bold uppercase tracking-wider text-foreground">
          Rent &amp; Gross Yield
        </h2>
        <span className="terminal-font rounded-sm bg-cyan-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-cyan-700 dark:text-cyan-300">
          New
        </span>
        <span className="text-[11px] text-muted-foreground">typical monthly rent &amp; gross yield by home size</span>
      </div>

      {loading ? (
        <div className="mt-4 h-32 w-full animate-pulse bg-muted/40" />
      ) : rows.length === 0 ? (
        <p className="mt-4 text-xs text-muted-foreground">No rental index coverage for this scope</p>
      ) : (
        <div className="mt-4">
          <div className="grid grid-cols-[3rem_1fr_1fr_2fr] gap-x-3 border-b border-border pb-2 terminal-font text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            <span>Beds</span>
            <span className="text-right">Rent / mo</span>
            <span className="text-right">Med. price</span>
            <span className="pl-3">Gross yield</span>
          </div>
          {rows.map((r) => {
            const y = r.grossYieldPct;
            return (
              <div key={r.beds} className="grid grid-cols-[3rem_1fr_1fr_2fr] items-center gap-x-3 border-b border-border/60 py-2 text-xs">
                <span className="font-mono font-bold text-foreground">{r.beds}BR</span>
                <span className="text-right font-mono text-foreground">{fmtRent(r.typicalRent)}</span>
                <span className="text-right font-mono text-muted-foreground">
                  {r.medianPrice != null ? fmtPrice(r.medianPrice) : "—"}
                </span>
                <div className="flex items-center gap-2 pl-3">
                  <div className="h-2.5 flex-1 overflow-hidden rounded-sm bg-muted/50">
                    {y != null && (
                      <div className="h-full rounded-sm bg-cyan-600 dark:bg-cyan-400" style={{ width: `${Math.min(100, (y / maxYield) * 100)}%` }} />
                    )}
                  </div>
                  <span className="w-12 shrink-0 text-right font-mono font-semibold text-cyan-700 dark:text-cyan-300">
                    {y != null ? `${y.toFixed(1)}%` : "—"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="terminal-font mt-3 text-[10px] text-muted-foreground">
        source · rental index rent × 12 ÷ 12-month median sold price · yields are approximate
      </p>
    </div>
  );
}

/** Phase-2 "Estimate Confidence" — sales-weighted AVM MAE headline + R² fit bar. */
function AvmConfidencePanel({ avm, loading }: { avm: AvmReliabilityData | null; loading: boolean }) {
  const mae = avm?.wavgMaePct ?? null;
  const r2 = avm?.wavgR2 ?? null;
  const sales = avm?.salesAnalyzed ?? 0;
  return (
    <div className="mt-5 border border-border bg-card/40 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="terminal-font text-[11px] font-bold uppercase tracking-wider text-foreground">
          Estimate Confidence
        </h2>
        <span className="terminal-font rounded-sm bg-cyan-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-cyan-700 dark:text-cyan-300">
          New
        </span>
        <span className="text-[11px] text-muted-foreground">how close our AVM lands in this area — we show our work</span>
      </div>

      {loading ? (
        <div className="mt-4 h-24 w-full animate-pulse bg-muted/40" />
      ) : sales === 0 || mae == null ? (
        <p className="mt-4 text-xs text-muted-foreground">Not enough model coverage for this area</p>
      ) : (
        <div className="mt-4 grid gap-6 sm:grid-cols-[1fr_1.4fr]">
          <div className="sm:border-r sm:border-border sm:pr-6">
            <div className="font-mono text-4xl font-bold leading-none text-cyan-700 dark:text-cyan-300">
              ±{mae.toFixed(1)}%
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              typical estimate lands within <span className="font-mono text-foreground">±{mae.toFixed(1)}%</span> of the eventual sale price
            </p>
          </div>
          <div className="self-center">
            <div className="flex items-baseline justify-between text-[11px]">
              <span className="terminal-font font-bold uppercase tracking-wider text-muted-foreground">Model fit (R²)</span>
              <span className="font-mono font-semibold text-foreground">{r2 != null ? r2.toFixed(2) : "—"}</span>
            </div>
            <div className="mt-2 h-3 w-full overflow-hidden rounded-sm bg-muted/50">
              <div
                className="h-full rounded-sm bg-gradient-to-r from-cyan-500 to-emerald-500"
                style={{ width: `${r2 != null ? Math.round(Math.min(1, Math.max(0, r2)) * 100) : 0}%` }}
              />
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              {r2 != null
                ? `R² explains ${Math.round(r2 * 100)}% of price variance across ${sales.toLocaleString()} recent sales`
                : `${sales.toLocaleString()} recent sales`}
            </p>
          </div>
        </div>
      )}

      <p className="terminal-font mt-3 text-[10px] text-muted-foreground">
        source · avm_audit_report · sales-weighted across {(avm?.cohortCount ?? 0).toLocaleString()} cohorts
      </p>
    </div>
  );
}

/** Single-series sparkline (no axis, so no dual-axis violation). */
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const n = values.length;
  const pts = values
    .map((v, i) => `${((i / (n - 1)) * 100).toFixed(2)},${(28 - ((v - min) / span) * 26).toFixed(2)}`)
    .join(" ");
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="h-14 w-full">
      <polyline points={pts} fill="none" className="stroke-cyan-600 dark:stroke-cyan-400" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function DeltaChip({ value, unit, invertColor = false }: { value: number | null; unit: string; invertColor?: boolean }) {
  if (value == null) return null;
  const up = value >= 0;
  const good = invertColor ? !up : up; // for stale%, up is bad
  return (
    <span className={`ml-2 font-mono text-[11px] font-bold ${good ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400"}`}>
      {up ? "▲" : "▼"} {Math.abs(value).toFixed(unit === "%" ? 1 : 0)}{unit}
    </span>
  );
}

/** Phase-2 "Inventory Trend" — daily active-inventory snapshots (accrues over time). */
function InventoryHistoryPanel({ points, loading }: { points: InventoryPointData[]; loading: boolean }) {
  const clean = points.filter((p) => p.activeCount != null);
  const n = clean.length;
  const last = n ? clean[n - 1] : null;
  const first = n ? clean[0] : null;
  const activeVals = clean.map((p) => p.activeCount as number);
  const activeDelta =
    n > 1 && first?.activeCount ? ((last!.activeCount! - first.activeCount) / first.activeCount) * 100 : null;
  const staleDelta =
    n > 1 && first?.stalePct != null && last?.stalePct != null ? (last.stalePct - first.stalePct) * 100 : null;

  return (
    <div className="mt-5 border border-border bg-card/40 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="terminal-font text-[11px] font-bold uppercase tracking-wider text-foreground">
          Inventory Trend
        </h2>
        <span className="terminal-font rounded-sm bg-cyan-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-cyan-700 dark:text-cyan-300">
          New
        </span>
        <span className="text-[11px] text-muted-foreground">active listings &amp; stale share, snapshotted daily</span>
      </div>

      {loading ? (
        <div className="mt-4 h-24 w-full animate-pulse bg-muted/40" />
      ) : n === 0 ? (
        <p className="mt-4 text-xs text-muted-foreground">Inventory history isn’t tracked for this area yet — available for the main GTA markets.</p>
      ) : (
        <div className="mt-4 grid gap-6 sm:grid-cols-[1fr_1.4fr]">
          <div className="grid grid-cols-2 gap-4 self-center sm:grid-cols-1">
            <div>
              <div className="flex items-baseline">
                <span className="font-mono text-3xl font-bold text-foreground">
                  {last!.activeCount!.toLocaleString()}
                </span>
                <DeltaChip value={activeDelta} unit="%" />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">active listings</p>
            </div>
            <div>
              <div className="flex items-baseline">
                <span className="font-mono text-3xl font-bold text-rose-600 dark:text-rose-400">
                  {last!.stalePct != null ? `${Math.round(last!.stalePct * 100)}%` : "—"}
                </span>
                <DeltaChip value={staleDelta} unit="pp" invertColor />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">stale (60d+)</p>
            </div>
          </div>
          <div className="self-center">
            {n >= 2 ? (
              <>
                <div className="mb-1 flex justify-between font-mono text-[10px] text-muted-foreground">
                  <span>{first!.date}</span>
                  <span>active listings</span>
                  <span>{last!.date}</span>
                </div>
                <Sparkline values={activeVals} />
              </>
            ) : (
              <div className="rounded-sm border border-dashed border-border px-3 py-4 text-center text-[11px] text-muted-foreground">
                First snapshot captured <span className="font-mono text-foreground">{first!.date}</span>.
                <br />The trend line fills in as daily snapshots accrue.
              </div>
            )}
          </div>
        </div>
      )}

      <p className="terminal-font mt-3 text-[10px] text-muted-foreground">
        source · {n} daily snapshot{n === 1 ? "" : "s"} · appended by the nightly market refresh
      </p>
    </div>
  );
}

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Phase-2 "Seasonality" — diverging price-index bars (sell-favorable up / buy-favorable down). */
function SeasonalityPanel({ months, loading }: { months: SeasonMonthData[]; loading: boolean }) {
  const withIdx = months.filter((m) => m.priceIndexPct != null);
  const maxAbs = Math.max(2, ...withIdx.map((m) => Math.abs(m.priceIndexPct!)));
  const bestSell = withIdx.length ? withIdx.reduce((a, b) => (b.priceIndexPct! > a.priceIndexPct! ? b : a)) : null;
  const bestBuy = withIdx.length ? withIdx.reduce((a, b) => (b.priceIndexPct! < a.priceIndexPct! ? b : a)) : null;
  const byMonth = new Map(months.map((m) => [m.month, m]));
  const label = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;

  return (
    <div className="mt-5 border border-border bg-card/40 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="terminal-font text-[11px] font-bold uppercase tracking-wider text-foreground">
          Seasonality
        </h2>
        <span className="terminal-font rounded-sm bg-cyan-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-cyan-700 dark:text-cyan-300">
          New
        </span>
        <span className="text-[11px] text-muted-foreground">when to buy vs sell — 5-year sold pattern, year-normalized</span>
      </div>

      {loading ? (
        <div className="mt-4 h-32 w-full animate-pulse bg-muted/40" />
      ) : withIdx.length === 0 ? (
        <p className="mt-4 text-xs text-muted-foreground">Not enough sold history for a seasonal pattern</p>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-4">
            <div className="rounded-sm border border-emerald-500/30 bg-emerald-500/5 px-3 py-2">
              <div className="terminal-font text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">Best month to sell</div>
              <div className="mt-1 font-mono text-lg font-bold text-foreground">
                {bestSell ? MONTH_ABBR[bestSell.month - 1] : "—"}
                {bestSell?.priceIndexPct != null && (
                  <span className="ml-2 text-sm text-emerald-700 dark:text-emerald-400">{label(bestSell.priceIndexPct)}</span>
                )}
              </div>
              <div className="text-[11px] text-muted-foreground">vs the year’s median</div>
            </div>
            <div className="rounded-sm border border-sky-500/30 bg-sky-500/5 px-3 py-2">
              <div className="terminal-font text-[10px] font-bold uppercase tracking-wider text-sky-700 dark:text-sky-400">Best month to buy</div>
              <div className="mt-1 font-mono text-lg font-bold text-foreground">
                {bestBuy ? MONTH_ABBR[bestBuy.month - 1] : "—"}
                {bestBuy?.priceIndexPct != null && (
                  <span className="ml-2 text-sm text-sky-700 dark:text-sky-400">{label(bestBuy.priceIndexPct)}</span>
                )}
              </div>
              <div className="text-[11px] text-muted-foreground">vs the year’s median</div>
            </div>
          </div>

          {/* diverging bars: above midline = sold above year-median (sell), below = under (buy) */}
          <div className="mt-6">
            <div className="relative flex h-28 items-stretch gap-1">
              <div className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-border" />
              {Array.from({ length: 12 }, (_, i) => i + 1).map((mn) => {
                const m = byMonth.get(mn);
                const v = m?.priceIndexPct ?? null;
                const pos = (v ?? 0) >= 0;
                const isSell = bestSell && m?.month === bestSell.month;
                const isBuy = bestBuy && m?.month === bestBuy.month;
                const cls = pos
                  ? isSell ? "bg-emerald-600 dark:bg-emerald-400" : "bg-emerald-500/60"
                  : isBuy ? "bg-sky-600 dark:bg-sky-400" : "bg-sky-500/60";
                const h = v != null ? `${(Math.abs(v) / maxAbs) * 46}%` : "0%";
                const title = m
                  ? `${MONTH_ABBR[mn - 1]} · ${v != null ? label(v) : "—"} vs year-median · ${m.sales.toLocaleString()} sales${m.soldToList != null ? ` · ${m.soldToList}% s2l` : ""}`
                  : MONTH_ABBR[mn - 1];
                return (
                  <div key={mn} className="relative flex-1" title={title}>
                    {v != null && (
                      <div
                        className={`absolute left-1/2 w-2.5 -translate-x-1/2 rounded-sm ${cls}`}
                        style={pos ? { bottom: "50%", height: h } : { top: "50%", height: h }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
            <div className="mt-1 flex gap-1">
              {MONTH_ABBR.map((mo, i) => (
                <span key={i} className="flex-1 text-center font-mono text-[9px] text-muted-foreground">{mo[0]}</span>
              ))}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-[2px] bg-emerald-500/60" /> sold above year-median (seller-favorable)</span>
            <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-[2px] bg-sky-500/60" /> sold below (buyer-favorable)</span>
          </div>
        </>
      )}

      <p className="terminal-font mt-3 text-[10px] text-muted-foreground">
        source · 5-year raw_vow_sold · each sale indexed to its own year’s median
      </p>
    </div>
  );
}

/** Phase-3 "Price-Cut Activity" — recent multi-cut ledger (accrues nightly). */
function PriceLedgerPanel({ l, loading }: { l: PriceLedgerData | null; loading: boolean }) {
  const events = l?.cutEvents ?? 0;
  return (
    <div className="mt-5 border border-border bg-card/40 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="terminal-font text-[11px] font-bold uppercase tracking-wider text-foreground">
          Price-Cut Activity
        </h2>
        <span className="terminal-font rounded-sm bg-cyan-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-cyan-700 dark:text-cyan-300">
          New
        </span>
        <span className="text-[11px] text-muted-foreground">every reduction tracked — last 3 months</span>
      </div>

      {loading ? (
        <div className="mt-4 h-16 w-full animate-pulse bg-muted/40" />
      ) : events === 0 ? (
        <p className="mt-4 text-xs text-muted-foreground">
          Price-cut tracking just started — activity appears here as sellers adjust their asking prices.
        </p>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <div className="font-mono text-2xl font-bold text-rose-600 dark:text-rose-400">{events.toLocaleString()}</div>
            <div className="text-[11px] text-muted-foreground">price cuts</div>
          </div>
          <div>
            <div className="font-mono text-2xl font-bold text-foreground">{(l?.cutProperties ?? 0).toLocaleString()}</div>
            <div className="text-[11px] text-muted-foreground">properties</div>
          </div>
          <div>
            <div className="font-mono text-2xl font-bold text-rose-600 dark:text-rose-400">
              {l?.medianCutPct != null ? `−${l.medianCutPct.toFixed(1)}%` : "—"}
            </div>
            <div className="text-[11px] text-muted-foreground">median cut</div>
          </div>
          <div>
            <div className="font-mono text-2xl font-bold text-amber-600 dark:text-amber-400">{(l?.multiCutProperties ?? 0).toLocaleString()}</div>
            <div className="text-[11px] text-muted-foreground">cut 2+ times</div>
          </div>
        </div>
      )}

      <p className="terminal-font mt-3 text-[10px] text-muted-foreground">
        source · price_events ledger · nightly capture · complements the net price-cut pressure above
      </p>
    </div>
  );
}

/** Phase-2 "Sell-Through" — share of market exits that actually sold vs withdrew. */
function SellThroughPanel({ o, loading }: { o: ListingOutcomesData | null; loading: boolean }) {
  const soldC = o?.soldCount ?? 0;
  const failedC = o?.failedCount ?? 0;
  const total = soldC + failedC;
  // failed===0 with real sold volume ⇒ the delisted feed doesn't cover this region (e.g. Ottawa,
  // matched via CountyOrParish, which raw_vow_delisted lacks). Don't fall back to sold/total —
  // that renders a fake 100%. Show N/A instead.
  const noCoverage = soldC > 0 && failedC === 0;
  const sellThrough = noCoverage
    ? null
    : o?.failureRate != null
      ? 1 - o.failureRate
      : total > 0
        ? soldC / total
        : null;
  const soldPct = total > 0 ? (soldC / total) * 100 : 0;
  return (
    <div className="mt-5 border border-border bg-card/40 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="terminal-font text-[11px] font-bold uppercase tracking-wider text-foreground">
          Sell-Through
        </h2>
        <span className="terminal-font rounded-sm bg-cyan-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-cyan-700 dark:text-cyan-300">
          New
        </span>
        <span className="text-[11px] text-muted-foreground">of listings that came off the market, how many actually sold — 12 months</span>
      </div>

      {loading ? (
        <div className="mt-4 h-20 w-full animate-pulse bg-muted/40" />
      ) : total === 0 ? (
        <p className="mt-4 text-xs text-muted-foreground">No listing-outcome data for this scope</p>
      ) : noCoverage ? (
        <p className="mt-4 text-xs text-muted-foreground">
          Not available for this region yet — the withdrawn/de-listed feed doesn&apos;t cover it, so a
          sold-vs-withdrawn rate can&apos;t be computed ({soldC.toLocaleString()} sales tracked over 12 months).
        </p>
      ) : (
        <div className="mt-4 grid gap-6 sm:grid-cols-[1fr_1.3fr]">
          <div className="self-center">
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-4xl font-bold text-cyan-700 dark:text-cyan-300">
                {sellThrough != null ? `${Math.round(sellThrough * 100)}%` : "—"}
              </span>
              <span className="text-xs text-muted-foreground">sold</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              the other {sellThrough != null ? Math.round((1 - sellThrough) * 100) : "—"}% withdrew without a recorded sale
            </p>
          </div>
          <div className="self-center">
            <div className="flex h-4 w-full overflow-hidden rounded-sm">
              <div className="h-full bg-cyan-600 dark:bg-cyan-500" style={{ width: `${soldPct}%` }} title={`Sold · ${(o?.soldCount ?? 0).toLocaleString()}`} />
              <div className="ml-[2px] h-full flex-1 bg-rose-500/70" title={`Withdrawn · ${(o?.failedCount ?? 0).toLocaleString()}`} />
            </div>
            <div className="mt-3 grid grid-cols-3 gap-3 text-xs">
              <div>
                <div className="font-mono text-base font-semibold text-cyan-700 dark:text-cyan-300">{(o?.soldCount ?? 0).toLocaleString()}</div>
                <div className="text-[11px] text-muted-foreground">sold</div>
              </div>
              <div>
                <div className="font-mono text-base font-semibold text-rose-600 dark:text-rose-400">{(o?.failedCount ?? 0).toLocaleString()}</div>
                <div className="text-[11px] text-muted-foreground">withdrawn</div>
              </div>
              <div>
                <div className="font-mono text-base font-semibold text-foreground">{o?.medianFailedDom != null ? `${o.medianFailedDom}d` : "—"}</div>
                <div className="text-[11px] text-muted-foreground">median before giving up</div>
              </div>
            </div>
          </div>
        </div>
      )}

      <p className="terminal-font mt-3 text-[10px] text-muted-foreground">
        source · distinct SALE properties · withdrawn = left the market unsold &amp; not currently relisted · leases + active relists excluded
      </p>
    </div>
  );
}

export default function AnalyticsClient({ initial }: { initial?: AnalyticsInitial }) {
  const chart = useChartTheme();
  const router = useRouter();
  const searchParams = useSearchParams();

  // When the server prefetched a scope, seed state from it so the first render matches
  // (initial.region/typeKeys were derived from the same URL the server read).
  const [region, setRegion] = useState(() =>
    initial ? initial.region : (searchParams.get("region") || DEFAULT_REGION).trim()
  );
  const [typeKeys, setTypeKeys] = useState<string[]>(() =>
    initial
      ? initial.typeKeys
      : (searchParams.get("types") || "")
          .split(",")
          .map((k) => k.trim().toLowerCase())
          .filter((k) => PROPERTY_TYPE_OPTIONS.some((o) => o.key === k))
  );
  // One result object per fetched scope; `loading` is derived by comparing the
  // result's scope key to the current one (no synchronous setState in effects).
  // Seeded with the server-prefetched payload so above-the-fold KPIs paint instantly.
  const [result, setResult] = useState<{
    key: string;
    trend: PriceTrendResp | null;
    stats: RegionStatsResp | null;
    dom: DomDistResp | null;
    cuts: PriceCutsResp | null;
    dynamics: SoldDynamicsResp | null;
    rental: RentalYieldResp | null;
    avm: AvmReliabilityResp | null;
    inventory: InventoryHistoryResp | null;
    seasonality: SeasonalityResp | null;
    outcomes: ListingOutcomesResp | null;
    ledger: PriceLedgerResp | null;
    error: boolean;
  } | null>(() =>
    initial
      ? {
          key: makeScopeKey(initial.region, initial.typeKeys),
          trend: initial.trend,
          stats: initial.stats,
          dom: initial.dom,
          cuts: initial.cuts,
          dynamics: initial.dynamics,
          rental: initial.rental,
          avm: initial.avm,
          inventory: initial.inventory,
          seasonality: initial.seasonality,
          outcomes: initial.outcomes,
          ledger: initial.ledger,
          error: initial.trend == null && initial.stats == null,
        }
      : null
  );
  const [metric, setMetric] = useState<Metric>("price");

  const scopeKey = makeScopeKey(region, typeKeys);

  // Mirror scope into the URL (shareable, refresh-safe). replace() keeps history clean.
  useEffect(() => {
    const q = new URLSearchParams();
    if (region && region !== DEFAULT_REGION) q.set("region", region);
    if (typeKeys.length) q.set("types", typeKeys.join(","));
    const qs = q.toString();
    router.replace(qs ? `/analytics?${qs}` : "/analytics", { scroll: false });
  }, [region, typeKeys, router]);

  useEffect(() => {
    let alive = true;
    // Already have data for this scope (server-seeded on mount, or previously fetched) —
    // skip the redundant round-trip. The effect re-runs only when scopeKey changes, so
    // `result` here is the latest at that point. New scopes fall through to fetch.
    if (result?.key === scopeKey) return;
    const t = typeKeys.length ? `&types=${encodeURIComponent(typeKeys.join(","))}` : "";
    const q = encodeURIComponent(region);
    Promise.all([
      fetch(`/api/market/price-trend?region=${q}${t}`).then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/market/region-stats?region=${q}${t}`).then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/market/dom-distribution?region=${q}${t}`).then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/market/price-cuts?region=${q}${t}`).then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/market/sold-dynamics?region=${q}${t}`).then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/market/rental-yield?region=${q}${t}`).then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/market/avm-reliability?region=${q}${t}`).then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/market/inventory-history?region=${q}`).then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/market/seasonality?region=${q}${t}`).then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/market/listing-outcomes?region=${q}${t}`).then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/market/price-ledger?region=${q}`).then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([tr, st, dm, ct, dy, re, av, iv, se, oc, pl]) => {
        if (!alive) return;
        setResult({
          key: scopeKey,
          trend: tr as PriceTrendResp | null,
          stats: st as RegionStatsResp | null,
          dom: dm as DomDistResp | null,
          cuts: ct as PriceCutsResp | null,
          dynamics: dy as SoldDynamicsResp | null,
          rental: re as RentalYieldResp | null,
          avm: av as AvmReliabilityResp | null,
          inventory: iv as InventoryHistoryResp | null,
          seasonality: se as SeasonalityResp | null,
          outcomes: oc as ListingOutcomesResp | null,
          ledger: pl as PriceLedgerResp | null,
          error: tr == null && st == null,
        });
      })
      .catch(() => {
        if (!alive) return;
        setResult({ key: scopeKey, trend: null, stats: null, dom: null, cuts: null, dynamics: null, rental: null, avm: null, inventory: null, seasonality: null, outcomes: null, ledger: null, error: true });
      });
    return () => {
      alive = false;
    };
    // scopeKey is derived from region+typeKeys; it is the only real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey]);

  const loading = result?.key !== scopeKey;
  const error = !loading && !!result?.error;
  const trend = !loading ? result?.trend ?? null : null;
  const stats = !loading ? result?.stats ?? null : null;
  const dom = !loading ? result?.dom?.dom ?? null : null;
  const cuts = !loading ? result?.cuts?.cuts ?? null : null;
  const dynamics = !loading ? result?.dynamics?.dynamics ?? null : null;
  const rental = !loading ? result?.rental?.rental?.rows ?? [] : [];
  const avm = !loading ? result?.avm?.avm ?? null : null;
  const inventory = !loading ? result?.inventory?.inventory?.points ?? [] : [];
  const seasonality = !loading ? result?.seasonality?.seasonality?.months ?? [] : [];
  const outcomes = !loading ? result?.outcomes?.outcomes ?? null : null;
  const ledger = !loading ? result?.ledger?.ledger ?? null : null;

  const score = useMemo(() => assembleRegionScore(region, trend, stats), [region, trend, stats]);
  const points = trend?.points ?? [];

  const toggleType = useCallback((key: string) => {
    setTypeKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }, []);

  const temp = score.temperature ? TEMP_STYLE[score.temperature] : null;
  const isSales = metric === "sales";
  const lineKey = metric === "ppsf" ? "medianPpsf" : metric === "s2l" ? "soldToList" : "medianPrice";
  const lineFmt =
    metric === "ppsf"
      ? (v: number) => `$${Math.round(v)}`
      : metric === "s2l"
        ? (v: number) => `${Math.round(v)}%`
        : fmtPrice;

  return (
    <div className="min-h-app bg-background text-foreground">
      <div className="mx-auto max-w-6xl px-4 py-6 pb-safe">
        {/* Header: title + region picker */}
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="terminal-font text-lg font-bold uppercase tracking-wider text-foreground">
              Market Trends — {region}
            </h1>
            <p className="mt-1 text-xs text-muted-foreground">
              Full-population sold &amp; active aggregates · refreshed with the daily sync
            </p>
          </div>
          <LocationSearch
            className="w-full md:w-80 [&_input]:h-11 md:[&_input]:h-7"
            onPlace={(label) => setRegion(label)}
            placeholder="Change city or neighbourhood…"
          />
        </div>

        {/* Property-type scope chips */}
        <div className="mt-4 flex items-center gap-1.5 overflow-x-auto no-scrollbar md:flex-wrap pb-1 -mx-4 px-4">
          <button
            type="button"
            onClick={() => setTypeKeys([])}
            aria-pressed={typeKeys.length === 0}
            className={`terminal-font shrink-0 min-h-[44px] flex items-center border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors ${
              typeKeys.length === 0
                ? "border-cyan-600 bg-cyan-600 text-white dark:border-cyan-500/60 dark:bg-cyan-500/20 dark:text-cyan-300"
                : "border-border text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            }`}
          >
            All Types
          </button>
          {PROPERTY_TYPE_OPTIONS.map((o) => {
            const active = typeKeys.includes(o.key);
            return (
              <button
                key={o.key}
                type="button"
                onClick={() => toggleType(o.key)}
                aria-pressed={active}
                className={`terminal-font shrink-0 min-h-[44px] flex items-center border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors ${
                  active
                    ? "border-cyan-600 bg-cyan-600 text-white dark:border-cyan-500/60 dark:bg-cyan-500/20 dark:text-cyan-300"
                    : "border-border text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                }`}
              >
                {o.label}
              </button>
            );
          })}
        </div>

        {error && (
          <p className="mt-6 border border-rose-900/60 bg-rose-950/30 px-4 py-3 text-sm text-rose-700 dark:text-rose-400">
            Failed to load market data — try again shortly.
          </p>
        )}

        {/* KPI grid */}
        <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
          <KpiCard
            label="Median Sold Price"
            value={score.medianPrice != null ? fmtPrice(score.medianPrice) : "—"}
            sub={
              <span className="inline-flex flex-wrap items-center gap-x-1.5">
                <YoYBadge pct={score.yoyPct} />
                {score.avgPrice != null && (
                  <span className="whitespace-nowrap" title="Mean sale price — the figure TRREB/CREA headline (runs above the median)">
                    avg {fmtPrice(score.avgPrice)}
                  </span>
                )}
              </span>
            }
            loading={loading}
          />
          <KpiCard
            label="Median $ / Sqft"
            value={score.medianPpsf != null ? `$${Math.round(score.medianPpsf)}` : "—"}
            sub={<YoYBadge pct={score.ppsfYoyPct} />}
            loading={loading}
          />
          <KpiCard
            label="Sold-to-List"
            value={score.soldToListPct != null ? `${score.soldToListPct.toFixed(1)}%` : "—"}
            sub={
              score.pctOverAsking != null
                ? `${score.pctOverAsking.toFixed(0)}% sold over asking`
                : "low list-price coverage"
            }
            loading={loading}
          />
          <KpiCard
            label="Months of Inventory"
            value={score.monthsOfSupply != null ? score.monthsOfSupply.toFixed(1) : "—"}
            sub={
              temp && (
                <span
                  className={`terminal-font inline-block border px-2 py-1 text-[11px] font-bold uppercase tracking-wider ${temp.cls}`}
                >
                  {temp.label}
                </span>
              )
            }
            loading={loading}
          />
          <KpiCard
            label="Active Listings"
            value={score.activeCount != null ? score.activeCount.toLocaleString() : "—"}
            sub={score.stalePct != null ? `${score.stalePct.toFixed(0)}% stale (60d+ DOM)` : undefined}
            loading={loading}
          />
          <KpiCard
            label="Sales / Month"
            value={
              trend?.summary.monthlyVelocity != null
                ? Math.round(trend.summary.monthlyVelocity).toLocaleString()
                : "—"
            }
            sub={
              trend?.summary.sales90 ? `${trend.summary.sales90.toLocaleString()} sold · 90d` : undefined
            }
            loading={loading}
          />
        </div>

        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          Figures are computed from the VOW (Virtual Office Website) data feed, a subset of the full
          MLS® — sale <span className="whitespace-nowrap">counts</span> run modestly below board
          totals, so read counts as directional. Prices, ratios and days-on-market are unaffected.
        </p>

        {/* Phase-2: Market momentum (derived from the trend points — no extra fetch) */}
        <MomentumPanel points={points} loading={loading} />

        {/* Phase-2: Inventory trend (daily active-inventory snapshots — accrues over time) */}
        <InventoryHistoryPanel points={inventory} loading={loading} />

        {/* Tier-1: True Days on Market (relist-stitched median + aging + 60d stale + hidden gap) */}
        <TrueDomPanel dom={dom} loading={loading} />

        {/* Tier-1 B: Price-cut pressure */}
        <PriceCutPanel cuts={cuts} loading={loading} />

        {/* Phase-3: Multi-cut price ledger (every reduction, accrues nightly) */}
        <PriceLedgerPanel l={ledger} loading={loading} />

        {/* Tier-1 C: Absorption & sell-through (derived from months-of-supply) */}
        <AbsorptionPanel
          monthsSupply={score.monthsOfSupply}
          monthlyVelocity={trend?.summary.monthlyVelocity ?? null}
          loading={loading}
        />

        {/* Phase-2: Sell-through / withdrawal rate (sold vs de-listed, address-deduped) */}
        <SellThroughPanel o={outcomes} loading={loading} />

        {/* Trend chart */}
        <div className="mt-5 border border-border bg-card/40">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
            <h2 className="terminal-font text-[11px] font-bold uppercase tracking-wider text-foreground">
              24-Month Sold Trend
            </h2>
            <div className="flex items-center gap-2">
              <div className="flex border border-border">
                {METRIC_TABS.map(([id, label]) => {
                  const active = id === metric;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setMetric(id)}
                      aria-pressed={active}
                      className={`terminal-font min-h-[44px] flex items-center border-r border-border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors last:border-r-0 ${
                        active
                          ? "bg-cyan-600 text-white dark:bg-cyan-500/20 dark:text-cyan-300"
                          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <span className="terminal-font hidden text-[10px] uppercase tracking-wider text-muted-foreground sm:inline">
                Latest months still accruing
              </span>
            </div>
          </div>
          <div className="h-[240px] sm:h-[320px] lg:h-[380px] p-3">
            {loading && <div className="h-full w-full animate-pulse bg-muted/40" />}
            {!loading && points.length === 0 && (
              <p className="flex h-full items-center justify-center text-xs text-muted-foreground">
                No recent sold data for this scope
              </p>
            )}
            {!loading && points.length > 0 && (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                  <CartesianGrid stroke={chart.grid} vertical={false} />
                  <XAxis
                    dataKey="month"
                    tickFormatter={shortMonth}
                    tick={{ fill: chart.axisText, fontSize: 10 }}
                    stroke={chart.axisLine}
                    minTickGap={24}
                  />
                  <YAxis
                    yAxisId="left"
                    tickFormatter={isSales ? undefined : lineFmt}
                    tick={{ fill: chart.axisText, fontSize: 10 }}
                    stroke={chart.axisLine}
                    width={52}
                    allowDecimals={false}
                    hide={isSales}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tick={{ fill: chart.axisText, fontSize: 10 }}
                    stroke={chart.axisLine}
                    width={36}
                    allowDecimals={false}
                    hide={!isSales}
                  />
                  <Tooltip
                    trigger="click"
                    wrapperStyle={{ zIndex: 50 }}
                    cursor={{ fill: "rgba(100,116,139,0.15)" }}
                    allowEscapeViewBox={{ x: false, y: false }}
                    contentStyle={{ background: chart.tooltipBg, border: `1px solid ${chart.tooltipBorder}`, fontSize: 12 }}
                    labelFormatter={shortMonth}
                    formatter={(value, name) => {
                      if (name === "sales") return [Number(value).toLocaleString(), "Sales"];
                      const label =
                        metric === "ppsf" ? "Median $/sqft" : metric === "s2l" ? "Sold-to-list" : "Median price";
                      if (value == null) return ["—", label];
                      if (metric === "s2l") return [`${Number(value).toFixed(1)}%`, label];
                      return [fmtFull(Number(value)), label];
                    }}
                  />
                  <Bar yAxisId="right" dataKey="sales" fill={isSales ? chart.barAccent : chart.bar} radius={[2, 2, 0, 0]} />
                  {!isSales && (
                    <Line
                      yAxisId="left"
                      type="monotone"
                      dataKey={lineKey}
                      stroke={chart.line}
                      strokeWidth={2}
                      dot={false}
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Phase-2: Seasonality — best month to buy/sell (5-yr sold pattern) */}
        <SeasonalityPanel months={seasonality} loading={loading} />

        {/* Phase-2: Sold-side dynamics — time-to-sell + original-ask gap + $/sqft dispersion */}
        <SoldDynamicsPanel d={dynamics} loading={loading} />

        {/* Phase-2: Rent & gross yield by bedroom (dormant rental_market_index, now surfaced) */}
        <RentalYieldPanel rows={rental} loading={loading} />

        {/* Phase-2: AVM estimate confidence — sales-weighted R²/MAE for the area */}
        <AvmConfidencePanel avm={avm} loading={loading} />

        {/* Investor extras HouseSigma doesn't show: cap-rate aggregates for the active set */}
        {(score.medianCapRate != null || score.topCapRate != null) && (
          <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
            <KpiCard
              label="Median Cap Rate (Active)"
              value={score.medianCapRate != null ? `${score.medianCapRate.toFixed(2)}%` : "—"}
              loading={loading}
            />
            <KpiCard
              label="Top Cap Rate (Active)"
              value={score.topCapRate != null ? `${score.topCapRate.toFixed(2)}%` : "—"}
              loading={loading}
            />
            <KpiCard
              label="Avg Cap Rate (Active)"
              value={stats?.stats?.avgCapRate != null ? `${stats.stats.avgCapRate.toFixed(2)}%` : "—"}
              loading={loading}
            />
            <KpiCard
              label="List-Price Coverage"
              value={
                trend?.summary.listPriceCoverage != null
                  ? `${Math.round(trend.summary.listPriceCoverage * 100)}%`
                  : "—"
              }
              sub="of sold have a comparable list price"
              loading={loading}
            />
          </div>
        )}

        {/* §6.3(i)/(k) consumer notice — required on VOW-derived displays. */}
        <p className="mt-8 text-center text-[11px] leading-relaxed text-muted-foreground">
          Market data is deemed reliable but is not guaranteed accurate. Information is provided
          exclusively for consumers&apos; personal, non-commercial use and may only be used by
          consumers that have a bona fide interest in the purchase, sale, or lease of real estate.{" "}
          <Link href="/operated-by" className="underline underline-offset-2 hover:text-foreground">
            Operated under licence
          </Link>
          .
        </p>

        {/* Spacer so the fixed mobile CTA never covers the notice above. */}
        {!loading && <div className="h-20 md:hidden" />}
      </div>

      {/* Mobile-only lead path: jump from market data to live listings. */}
      {!loading && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 px-4 py-3 pb-safe backdrop-blur md:hidden">
          <a
            href={`/properties?city=${encodeURIComponent(region)}`}
            className="terminal-font flex min-h-[44px] items-center justify-center border border-cyan-600 bg-cyan-600 px-4 text-xs font-bold uppercase tracking-wider text-white transition-colors hover:bg-cyan-700 dark:border-cyan-500/60 dark:bg-cyan-500/20 dark:text-cyan-300 dark:hover:bg-cyan-500/30"
          >
            See live deals in {region} →
          </a>
        </div>
      )}
    </div>
  );
}
