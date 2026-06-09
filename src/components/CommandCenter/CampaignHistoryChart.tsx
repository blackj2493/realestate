/**
 * CampaignHistoryChart — the redesigned Property-History hero (Treatment 2).
 *
 * Two stacked lanes that each do one job honestly:
 *   • "Asking-price path · by event"  — sale-price points spaced EVENLY (ordinal),
 *     so the price trajectory reads with zero calendar-clustering.
 *   • "Timeline · by date"            — every campaign as a time-scaled bar
 *     (sale/lease), off-market = gaps, the current stitched span = True DOM.
 *
 * Pure + static SVG (no hooks) → server-renderable; fed CampaignEvents that are
 * already gated ([] for anon, so this renders nothing and the page shows the
 * locked teaser instead). nowMs is passed from the server (stable per request).
 */

import { Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  buildCampaignBars,
  buildSalePricePath,
  summarizeSaleHistory,
  type CampaignBar,
  type PricePathPoint,
} from "@/lib/campaignHistory/timeline";
import type { CampaignEvent, CampaignStatus } from "@/lib/campaignHistory/types";

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";
const SALE = "#10b981";
const LEASE = "#0ea5e9";
const AMBER = "#fbbf24";
const ROSE = "#fb7185";
const SLATE = "#94a3b8";
const CYAN = "#22d3ee";
const DIM = "#475569";

function compactPrice(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return `$${Math.round(n)}`;
}
function monthLabel(t: number): string {
  const d = new Date(t);
  const m = d.toLocaleDateString("en-US", { month: "short" });
  return d.getMonth() === 0 ? `${m}'${String(d.getFullYear()).slice(2)}` : m;
}
function shortDate(t: number): string {
  const d = new Date(t);
  return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" }).replace(" ", "'");
}
const STATUS_LABEL: Record<CampaignStatus, string> = {
  Active: "● Active", Terminated: "✕ Term", Expired: "Exp", Suspended: "Susp", Sold: "✓ Sold",
};
function statusColor(s: CampaignStatus): string {
  if (s === "Active") return CYAN;
  if (s === "Sold") return AMBER;
  if (s === "Terminated") return ROSE;
  return SLATE;
}

/** First-month-start ≥ tMin … last month ≤ tMax (deduped, thinned if too many). */
function monthTicks(tMin: number, tMax: number): number[] {
  const start = new Date(tMin);
  const ticks: number[] = [];
  const d = new Date(start.getFullYear(), start.getMonth(), 1);
  while (d.getTime() <= tMax) {
    if (d.getTime() >= tMin) ticks.push(d.getTime());
    d.setMonth(d.getMonth() + 1);
  }
  // thin so we never render more than ~10 labels
  const step = Math.ceil(ticks.length / 10);
  return step <= 1 ? ticks : ticks.filter((_, i) => i % step === 0);
}

/* ── price-path lane (event-spaced) ──────────────────────────────────────── */
function PricePathLane({ path }: { path: PricePathPoint[] }) {
  const X0 = 60, X1 = 988, YT = 22, YB = 96;
  const prices = path.map((p) => p.price);
  let pMin = Math.min(...prices), pMax = Math.max(...prices);
  if (pMin === pMax) { pMin -= 1; pMax += 1; }
  const pad = (pMax - pMin) * 0.18;
  pMin -= pad; pMax += pad;
  const x = (i: number) => (path.length === 1 ? (X0 + X1) / 2 : X0 + (i / (path.length - 1)) * (X1 - X0));
  const y = (p: number) => YT + ((pMax - p) / (pMax - pMin)) * (YB - YT);

  // 3 horizontal gridlines at min / mid / max of the padded scale
  const grid = [pMax - pad / 2, (pMin + pMax) / 2, pMin + pad / 2];

  return (
    <svg viewBox="0 0 1000 140" className="block h-auto w-full" role="img" aria-label="asking-price path by event">
      <g stroke="#1e293b" strokeWidth={1}>
        {grid.map((p, i) => <line key={i} x1={40} y1={y(p)} x2={1000} y2={y(p)} />)}
      </g>
      <g fill="#64748b" fontSize={11} fontFamily={MONO} textAnchor="end">
        {grid.map((p, i) => <text key={i} x={36} y={y(p) + 4}>{compactPrice(p)}</text>)}
      </g>
      {/* segments between consecutive points (dashed across non-stitched gaps) */}
      {path.slice(1).map((p, i) => (
        <line
          key={i}
          x1={x(i)} y1={y(path[i].price)} x2={x(i + 1)} y2={y(p.price)}
          stroke={p.offMarketBefore ? DIM : SALE}
          strokeWidth={p.offMarketBefore ? 1.6 : 2.5}
          strokeDasharray={p.offMarketBefore ? "3 5" : undefined}
        />
      ))}
      {path.map((p, i) => {
        const isActive = p.endStatus === "Active";
        const fill = isActive ? CYAN : p.kind === "Price Changed" ? AMBER : SALE;
        return (
          <g key={i}>
            <circle cx={x(i)} cy={y(p.price)} r={5} fill={fill} stroke="#0b1220" strokeWidth={1} />
            <text x={x(i)} y={y(p.price) - 10} fill={fill} fontSize={11} fontWeight={700} textAnchor="middle" fontFamily={MONO}>
              {compactPrice(p.price)}
            </text>
            <text x={x(i)} y={122} fill="#94a3b8" fontSize={10.5} textAnchor="middle" fontFamily={MONO}>{shortDate(p.dateMs)}</text>
            {p.endStatus && (
              <text x={x(i)} y={136} fill={statusColor(p.endStatus)} fontSize={9.5} textAnchor="middle" fontFamily={MONO}>
                {STATUS_LABEL[p.endStatus]}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/* ── ribbon lane (time-scaled) ───────────────────────────────────────────── */
function RibbonLane({ bars, trueDom }: { bars: CampaignBar[]; trueDom: number | null }) {
  const X0 = 44, X1 = 988, BY = 58, BH = 44;
  const tMin = Math.min(...bars.map((b) => b.startMs));
  const tMax = Math.max(...bars.map((b) => b.endMs));
  const sx = (t: number) => (tMax === tMin ? X0 : X0 + ((t - tMin) / (tMax - tMin)) * (X1 - X0));
  const ticks = monthTicks(tMin, tMax);

  const current = bars.filter((b) => b.isCurrent);
  const span = current.length
    ? { x1: Math.min(...current.map((b) => sx(b.startMs))), x2: Math.max(...current.map((b) => sx(b.endMs))) }
    : null;

  return (
    <svg viewBox="0 0 1000 165" className="block h-auto w-full" role="img" aria-label="campaign timeline by date">
      <g stroke="#1e293b" strokeWidth={1}>
        {ticks.map((t) => <line key={t} x1={sx(t)} y1={BY - 14} x2={sx(t)} y2={BY + BH + 8} />)}
      </g>
      <g fill="#64748b" fontSize={11.5} fontFamily={MONO}>
        {ticks.map((t) => <text key={t} x={sx(t)} y={BY + BH + 26}>{monthLabel(t)}</text>)}
      </g>

      {/* current stitched span → True DOM */}
      {span && (
        <>
          <rect x={span.x1 - 4} y={BY - 4} width={span.x2 - span.x1 + 8} height={BH + 8} rx={7} fill={CYAN} opacity={0.08} />
          <line x1={span.x1 - 4} y1={BY - 16} x2={span.x2 + 4} y2={BY - 16} stroke={CYAN} strokeWidth={1.2} />
          {trueDom != null && (
            <text x={(span.x1 + span.x2) / 2} y={BY - 21} fill={CYAN} fontSize={11.5} fontFamily={MONO} textAnchor="middle">
              True DOM {trueDom}d
            </text>
          )}
        </>
      )}

      {bars.map((b) => {
        const x1 = sx(b.startMs);
        const w = Math.max(sx(b.endMs) - x1, 30);
        const cx = x1 + w / 2;
        const sale = b.kind === "Sale";
        const label = b.priceChanged && b.startPrice != null && b.endPrice != null
          ? `${compactPrice(b.startPrice)}→${compactPrice(b.endPrice)}`
          : b.startPrice != null ? compactPrice(b.startPrice) : "—";
        return (
          <g key={b.listingKey}>
            <rect
              x={x1} y={BY} width={w} height={BH} rx={6}
              fill={sale ? SALE : LEASE}
              stroke={b.isCurrent ? CYAN : "none"} strokeWidth={b.isCurrent ? 2 : 0}
            />
            <text x={cx} y={BY + 26} fill={sale ? "#062e22" : "#042c43"} fontSize={w < 70 ? 10 : 12} fontWeight={700} textAnchor="middle" fontFamily={MONO}>
              {label}
            </text>
            <text x={cx} y={BY + BH + 16} fill={statusColor(b.endStatus)} fontSize={10.5} textAnchor="middle" fontFamily={MONO}>
              {sale ? STATUS_LABEL[b.endStatus] : `Lease · ${STATUS_LABEL[b.endStatus]}`}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function LegendItem({ c, label, dashed, ring }: { c: string; label: string; dashed?: boolean; ring?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {dashed ? (
        <i className="inline-block h-0 w-5 border-t border-dashed" style={{ borderColor: c }} />
      ) : ring ? (
        <i className="inline-block h-2.5 w-3.5 rounded-sm border-2" style={{ borderColor: c }} />
      ) : (
        <i className="inline-block h-2.5 w-3.5 rounded-sm" style={{ background: c }} />
      )}
      {label}
    </span>
  );
}

function Legend({ leaseCount }: { leaseCount: number }) {
  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-slate-400">
      <LegendItem c={SALE} label="For sale" />
      {leaseCount > 0 && <LegendItem c={LEASE} label="Lease" />}
      <LegendItem c={AMBER} label="Price change" />
      <LegendItem c={ROSE} label="Off-market" />
      <LegendItem c={DIM} label="Off-market gap" dashed />
      <LegendItem c={CYAN} label="Current campaign (True DOM)" ring />
    </div>
  );
}

export default function CampaignHistoryChart({
  events, trueDom, campaignCount, nowMs, className,
}: {
  events: CampaignEvent[];
  trueDom: number | null;
  campaignCount: number;
  nowMs: number;
  className?: string;
}) {
  const bars = buildCampaignBars(events, { nowMs });
  if (bars.length === 0) return null;
  const pricePath = buildSalePricePath(events, { nowMs });
  const summary = summarizeSaleHistory(events);
  const leaseCount = bars.filter((b) => b.kind === "Lease").length;

  return (
    <div className={cn("rounded-lg border border-slate-800 bg-slate-900/50 p-4 sm:p-5", className)}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-cyan-400" />
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-200">Property History</span>
        </div>
        <div className="font-mono text-xs text-slate-400">
          Listed <b className="text-emerald-400">{campaignCount}×</b>
          {trueDom != null && <> · True DOM <span className="text-cyan-400">{trueDom}d</span></>}
          {summary.originalSalePrice != null && summary.currentSalePrice != null && (
            <> · {compactPrice(summary.originalSalePrice)} → {compactPrice(summary.currentSalePrice)}
              {summary.dropPct != null && summary.dropPct !== 0 && (
                <span className={summary.dropPct < 0 ? "text-emerald-400" : "text-rose-400"}>
                  {" "}({summary.dropPct > 0 ? "+" : ""}{Math.round(summary.dropPct * 100)}%)
                </span>
              )}
            </>
          )}
        </div>
      </div>

      {pricePath.length > 0 && (
        <>
          <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-slate-500">Asking-price path · by event</div>
          <PricePathLane path={pricePath} />
          <div className="mb-1 mt-2 font-mono text-[10px] uppercase tracking-wider text-slate-500">Timeline · by date</div>
        </>
      )}
      <RibbonLane bars={bars} trueDom={trueDom} />
      <Legend leaseCount={leaseCount} />
    </div>
  );
}
