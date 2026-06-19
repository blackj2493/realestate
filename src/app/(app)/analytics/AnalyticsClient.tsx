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
import { useRouter, useSearchParams } from "next/navigation";
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

type Metric = "price" | "ppsf" | "sales";

const METRIC_TABS: [Metric, string][] = [
  ["price", "Median Price"],
  ["ppsf", "$ / Sqft"],
  ["sales", "Sales Volume"],
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
        pct >= 0 ? "text-emerald-400" : "text-rose-400"
      }`}
    >
      {pct >= 0 ? "▲" : "▼"} {Math.abs(pct).toFixed(1)}% YoY
    </span>
  );
}

const TEMP_STYLE: Record<NonNullable<RegionScore["temperature"]>, { label: string; cls: string }> = {
  hot: { label: "Seller's Market", cls: "bg-rose-500/15 text-rose-400 border-rose-500/40" },
  balanced: { label: "Balanced", cls: "bg-amber-500/15 text-amber-400 border-amber-500/40" },
  cold: { label: "Buyer's Market", cls: "bg-sky-500/15 text-sky-400 border-sky-500/40" },
};

interface KpiProps {
  label: string;
  value: string;
  sub?: React.ReactNode;
  loading: boolean;
}

function KpiCard({ label, value, sub, loading }: KpiProps) {
  return (
    <div className="border border-slate-800 bg-slate-900/40 px-4 py-3">
      <p className="terminal-font text-xs font-bold uppercase tracking-wider text-slate-400">
        {label}
      </p>
      {loading ? (
        <div className="mt-2 h-7 w-24 animate-pulse bg-slate-800/60" />
      ) : (
        <p className="mt-1 font-mono text-xl font-bold text-slate-100">{value}</p>
      )}
      <div className="mt-1 min-h-[16px] text-xs text-slate-400">{!loading && sub}</div>
    </div>
  );
}

export default function AnalyticsClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [region, setRegion] = useState(() => (searchParams.get("region") || DEFAULT_REGION).trim());
  const [typeKeys, setTypeKeys] = useState<string[]>(() =>
    (searchParams.get("types") || "")
      .split(",")
      .map((k) => k.trim().toLowerCase())
      .filter((k) => PROPERTY_TYPE_OPTIONS.some((o) => o.key === k))
  );
  // One result object per fetched scope; `loading` is derived by comparing the
  // result's scope key to the current one (no synchronous setState in effects).
  const [result, setResult] = useState<{
    key: string;
    trend: PriceTrendResp | null;
    stats: RegionStatsResp | null;
    error: boolean;
  } | null>(null);
  const [metric, setMetric] = useState<Metric>("price");

  const scopeKey = `${region}|${[...typeKeys].sort().join(",")}`;

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
    const t = typeKeys.length ? `&types=${encodeURIComponent(typeKeys.join(","))}` : "";
    const q = encodeURIComponent(region);
    Promise.all([
      fetch(`/api/market/price-trend?region=${q}${t}`).then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/market/region-stats?region=${q}${t}`).then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([tr, st]) => {
        if (!alive) return;
        setResult({
          key: scopeKey,
          trend: tr as PriceTrendResp | null,
          stats: st as RegionStatsResp | null,
          error: tr == null && st == null,
        });
      })
      .catch(() => {
        if (!alive) return;
        setResult({ key: scopeKey, trend: null, stats: null, error: true });
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

  const score = useMemo(() => assembleRegionScore(region, trend, stats), [region, trend, stats]);
  const points = trend?.points ?? [];

  const toggleType = useCallback((key: string) => {
    setTypeKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }, []);

  const temp = score.temperature ? TEMP_STYLE[score.temperature] : null;
  const isSales = metric === "sales";
  const lineKey = metric === "ppsf" ? "medianPpsf" : "medianPrice";
  const lineFmt = metric === "ppsf" ? (v: number) => `$${Math.round(v)}` : fmtPrice;

  return (
    <div className="min-h-app bg-slate-950 text-slate-200">
      <div className="mx-auto max-w-6xl px-4 py-6 pb-safe">
        {/* Header: title + region picker */}
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="terminal-font text-lg font-bold uppercase tracking-wider text-slate-100">
              Market Trends — {region}
            </h1>
            <p className="mt-1 text-xs text-slate-500">
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
                ? "border-cyan-500/60 bg-cyan-500/20 text-cyan-300"
                : "border-slate-700 text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
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
                    ? "border-cyan-500/60 bg-cyan-500/20 text-cyan-300"
                    : "border-slate-700 text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
                }`}
              >
                {o.label}
              </button>
            );
          })}
        </div>

        {error && (
          <p className="mt-6 border border-rose-900/60 bg-rose-950/30 px-4 py-3 text-sm text-rose-400">
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
            sub={score.stalePct != null ? `${score.stalePct.toFixed(0)}% stale (90d+ DOM)` : undefined}
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

        {/* Trend chart */}
        <div className="mt-5 border border-slate-800 bg-slate-900/40">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-3 py-2">
            <h2 className="terminal-font text-[11px] font-bold uppercase tracking-wider text-slate-200">
              24-Month Sold Trend
            </h2>
            <div className="flex items-center gap-2">
              <div className="flex border border-slate-700">
                {METRIC_TABS.map(([id, label]) => {
                  const active = id === metric;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setMetric(id)}
                      aria-pressed={active}
                      className={`terminal-font min-h-[44px] flex items-center border-r border-slate-700 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors last:border-r-0 ${
                        active
                          ? "bg-cyan-500/20 text-cyan-300"
                          : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <span className="terminal-font hidden text-[10px] uppercase tracking-wider text-slate-500 sm:inline">
                Latest months still accruing
              </span>
            </div>
          </div>
          <div className="h-[240px] sm:h-[320px] lg:h-[380px] p-3">
            {loading && <div className="h-full w-full animate-pulse bg-slate-800/40" />}
            {!loading && points.length === 0 && (
              <p className="flex h-full items-center justify-center text-xs text-slate-500">
                No recent sold data for this scope
              </p>
            )}
            {!loading && points.length > 0 && (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                  <CartesianGrid stroke="#1e293b" vertical={false} />
                  <XAxis
                    dataKey="month"
                    tickFormatter={shortMonth}
                    tick={{ fill: "#64748b", fontSize: 10 }}
                    stroke="#334155"
                    minTickGap={24}
                  />
                  <YAxis
                    yAxisId="left"
                    tickFormatter={isSales ? undefined : lineFmt}
                    tick={{ fill: "#64748b", fontSize: 10 }}
                    stroke="#334155"
                    width={52}
                    allowDecimals={false}
                    hide={isSales}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tick={{ fill: "#475569", fontSize: 10 }}
                    stroke="#334155"
                    width={36}
                    allowDecimals={false}
                    hide={!isSales}
                  />
                  <Tooltip
                    trigger="click"
                    wrapperStyle={{ zIndex: 50 }}
                    cursor={{ fill: "rgba(100,116,139,0.15)" }}
                    allowEscapeViewBox={{ x: false, y: false }}
                    contentStyle={{ background: "#0f172a", border: "1px solid #334155", fontSize: 12 }}
                    labelFormatter={shortMonth}
                    formatter={(value, name) => {
                      if (name === "sales") return [Number(value).toLocaleString(), "Sales"];
                      if (value == null) return ["—", metric === "ppsf" ? "Median $/sqft" : "Median price"];
                      return [
                        fmtFull(Number(value)),
                        metric === "ppsf" ? "Median $/sqft" : "Median price",
                      ];
                    }}
                  />
                  <Bar yAxisId="right" dataKey="sales" fill={isSales ? "#155e75" : "#1e3a4a"} radius={[2, 2, 0, 0]} />
                  {!isSales && (
                    <Line
                      yAxisId="left"
                      type="monotone"
                      dataKey={lineKey}
                      stroke="#22d3ee"
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
        <p className="mt-8 text-center text-[11px] leading-relaxed text-slate-600">
          Market data is deemed reliable but is not guaranteed accurate. Information is provided
          exclusively for consumers&apos; personal, non-commercial use and may only be used by
          consumers that have a bona fide interest in the purchase, sale, or lease of real estate.
        </p>

        {/* Spacer so the fixed mobile CTA never covers the notice above. */}
        {!loading && <div className="h-20 md:hidden" />}
      </div>

      {/* Mobile-only lead path: jump from market data to live listings. */}
      {!loading && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-800 bg-slate-950/95 px-4 py-3 pb-safe backdrop-blur md:hidden">
          <a
            href={`/properties?city=${encodeURIComponent(region)}`}
            className="terminal-font flex min-h-[44px] items-center justify-center border border-cyan-500/60 bg-cyan-500/20 px-4 text-xs font-bold uppercase tracking-wider text-cyan-300 transition-colors hover:bg-cyan-500/30"
          >
            See live deals in {region} →
          </a>
        </div>
      )}
    </div>
  );
}
