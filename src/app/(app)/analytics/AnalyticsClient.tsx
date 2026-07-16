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

/** Server-prefetched initial scope + payloads (from analytics/page.tsx). */
export interface AnalyticsInitial {
  region: string;
  typeKeys: string[];
  trend: PriceTrendResp | null;
  stats: RegionStatsResp | null;
  dom: DomDistResp | null;
  cuts: PriceCutsResp | null;
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

/** Tier-1 "True Days on Market" panel — median hero + p25/p75 + aging curve + 60d stale share. */
function TrueDomPanel({ dom, loading }: { dom: DomDistData | null; loading: boolean }) {
  const active = dom?.activeCount ?? 0;
  const b = dom?.buckets;
  const pct = (n: number) => (active > 0 ? (n / active) * 100 : 0);
  const staleLineLeft = b ? pct(b.d0_14 + b.d15_30 + b.d31_60) : 0;
  const mt = dom?.medianTrueDom ?? null;
  const mn = dom?.medianNaiveDom ?? null;
  const gapMult = mt != null && mn != null && mn > 0 ? mt / mn : null;
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
        <div className="mt-4 h-24 w-full animate-pulse bg-muted/40" />
      ) : active === 0 ? (
        <p className="mt-4 text-xs text-muted-foreground">No active inventory for this scope</p>
      ) : (
        <div className="mt-4 grid gap-6 md:grid-cols-[minmax(150px,0.7fr)_1.7fr]">
          {/* hero median */}
          <div>
            <div className="font-mono text-5xl font-bold leading-none text-cyan-700 dark:text-cyan-300">
              {dom!.medianTrueDom ?? "—"}
              <span className="ml-1 text-xl text-muted-foreground">d</span>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              median true DoM ·{" "}
              <span className="font-mono">p25 {dom!.p25 ?? "—"} · p75 {dom!.p75 ?? "—"}</span>
            </p>
            {/* Self-suppressing: only shown where TRUE DoM genuinely exceeds the naive/feed
                median (>=1.15x). Where the true_dom=0 coverage gap inverts the medians, the
                block simply doesn't render — never a false "N× longer" claim. */}
            {mn != null && gapMult != null && gapMult >= 1.15 && (
              <div className="mt-3 rounded-sm border border-border bg-background/40 px-2.5 py-2">
                <div className="terminal-font text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Hidden DoM gap
                </div>
                <div className="mt-1 flex flex-wrap items-baseline gap-x-1.5 text-xs">
                  <span className="text-muted-foreground">MLS # shows</span>
                  <span className="font-mono font-semibold text-foreground">{mn}d</span>
                  <span className="font-mono font-bold text-cyan-700 dark:text-cyan-300">· {gapMult.toFixed(1)}× longer</span>
                </div>
                <p className="mt-1 text-[11px] leading-tight text-muted-foreground">
                  the feed number resets on every relist
                </p>
              </div>
            )}
          </div>

          {/* aging curve */}
          <div>
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
                <div
                  className="absolute -top-1 w-0 border-l-2 border-dashed border-rose-500"
                  style={{ left: `${staleLineLeft}%`, bottom: "-14px" }}
                >
                  <span className="absolute -top-3 left-1 whitespace-nowrap bg-card px-1 text-[9px] font-bold text-rose-600 dark:text-rose-400">
                    60d stale
                  </span>
                </div>
              )}
            </div>
            <div className="mt-6 flex items-baseline gap-2">
              <span className="font-mono text-2xl font-bold text-rose-600 dark:text-rose-400">
                {dom!.stalePct != null ? `${Math.round(dom!.stalePct * 100)}%` : "—"}
              </span>
              <span className="text-xs text-muted-foreground">
                stale — past the 60d+ line; inventory the seller can’t move
              </span>
            </div>
          </div>
        </div>
      )}

      <p className="terminal-font mt-3 text-[10px] text-muted-foreground">
        source · relist-stitched TrueDom · median across {active.toLocaleString()} active listings
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
    error: boolean;
  } | null>(() =>
    initial
      ? {
          key: makeScopeKey(initial.region, initial.typeKeys),
          trend: initial.trend,
          stats: initial.stats,
          dom: initial.dom,
          cuts: initial.cuts,
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
    ])
      .then(([tr, st, dm, ct]) => {
        if (!alive) return;
        setResult({
          key: scopeKey,
          trend: tr as PriceTrendResp | null,
          stats: st as RegionStatsResp | null,
          dom: dm as DomDistResp | null,
          cuts: ct as PriceCutsResp | null,
          error: tr == null && st == null,
        });
      })
      .catch(() => {
        if (!alive) return;
        setResult({ key: scopeKey, trend: null, stats: null, dom: null, cuts: null, error: true });
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
            sub={<YoYBadge pct={score.yoyPct} />}
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

        {/* Tier-1: True Days on Market (relist-stitched median + aging + 60d stale + hidden gap) */}
        <TrueDomPanel dom={dom} loading={loading} />

        {/* Tier-1 B: Price-cut pressure */}
        <PriceCutPanel cuts={cuts} loading={loading} />

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
