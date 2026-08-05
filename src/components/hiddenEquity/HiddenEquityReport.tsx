// src/components/hiddenEquity/HiddenEquityReport.tsx
import Link from "next/link";
import { formatPrice } from "@/lib/utils";
import type { AVMResult } from "@/lib/avm/types";
import type { ValueAddReport } from "@/lib/avm/valueAdd/types";
import { shouldRender, buildView, type LedgerRow } from "@/components/Property/forceAppreciationView";
import Disclaimers from "./Disclaimers";

// ── Presentational helpers (local — do NOT import ForceAppreciationCard default) ──

function PaybackBar({ payback }: { payback: number }) {
  const safe = Number.isFinite(payback) ? Math.max(0, payback) : 0;
  const pct = (Math.min(safe, 3) / 3) * 100;
  return (
    <span className="inline-block h-1.5 w-10 rounded bg-muted align-middle">
      <span className="block h-full rounded bg-emerald-500" style={{ width: `${pct}%` }} />
    </span>
  );
}

function Row({ row }: { row: LedgerRow }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="truncate text-foreground">{row.label}</span>
      <span className="flex shrink-0 items-center gap-2 font-mono">
        <span className="text-emerald-700 dark:text-emerald-400">+{formatPrice(row.valueTyp)}</span>
        <span className="text-muted-foreground">−{formatPrice(row.costTyp)}</span>
        <PaybackBar payback={row.payback} />
        <span className="w-9 text-right text-muted-foreground">
          {Number.isFinite(row.payback) ? row.payback.toFixed(1) : "—"}×
        </span>
      </span>
    </div>
  );
}

const CONFIDENCE_CHIP: Record<AVMResult["confidence"], string> = {
  HIGH:   "border-emerald-600/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  MEDIUM: "border-yellow-600/40  bg-yellow-500/10  text-yellow-700  dark:text-yellow-300",
  LOW:    "border-border         bg-muted/40       text-muted-foreground",
};

// ── Main export ──────────────────────────────────────────────────────────────

interface HiddenEquityReportProps {
  estimate: AVMResult | null;
  report:   ValueAddReport | null;
}

export default function HiddenEquityReport({ estimate, report }: HiddenEquityReportProps) {
  // 1. No usable estimate
  if (!estimate || estimate.estimatedValue <= 0) {
    return (
      <div className="space-y-4 rounded-xl border border-border bg-card p-6">
        <p className="text-sm text-foreground">
          We couldn&apos;t produce a confident estimate for this home yet — try
          adjusting the details.
        </p>
        <Disclaimers />
      </div>
    );
  }

  // 2. Estimate available
  const { estimatedValue, confidence, lowBand, highBand } = estimate;

  // 3. Value-add section
  const hasValueAdd = shouldRender(report);
  const v = hasValueAdd ? buildView(report) : null;
  const vaConfidence = report?.confidence ?? null;

  return (
    <div className="space-y-6 rounded-xl border border-border bg-card p-6">
      {/* ── Estimate headline ── */}
      <div className="space-y-1">
        <p className="text-3xl font-bold text-emerald-700 dark:text-emerald-400">
          {formatPrice(estimatedValue)}
        </p>

        {lowBand > 0 && highBand > 0 && (
          <p className="font-mono text-xs text-muted-foreground">
            estimated range&nbsp;
            {formatPrice(lowBand)}–{formatPrice(highBand)}
          </p>
        )}

        <span
          className={`inline-block rounded border px-2 py-0.5 font-mono text-xs ${CONFIDENCE_CHIP[confidence]}`}
        >
          {confidence} CONFIDENCE
        </span>
      </div>

      {/* ── Hidden equity section ── */}
      {hasValueAdd && v ? (
        <div className="space-y-3 border-t border-border pt-4">
          {/* Section header */}
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">Hidden Equity</h3>
            <div className="flex items-center gap-2">
              {vaConfidence && (
                <span
                  className={`inline-block rounded border px-2 py-0.5 font-mono text-xs ${CONFIDENCE_CHIP[vaConfidence]}`}
                  title="How reliable this neighbourhood's renovation model is, based on recent local sales."
                >
                  {vaConfidence} CONFIDENCE
                </span>
              )}
              <span className="rounded border border-emerald-600/40 bg-emerald-500/10 px-2 py-0.5 font-mono text-xs text-emerald-700 dark:text-emerald-300">
                Score {v.score}/100
              </span>
            </div>
          </div>

          {/* Consumer-friendly headline */}
          <p className="text-sm text-foreground">
            You could unlock up to{" "}
            <b className="text-emerald-700 dark:text-emerald-400">{formatPrice(v.headlineGross)}</b> in
            hidden equity — about{" "}
            <b className="text-emerald-700 dark:text-emerald-400">{formatPrice(v.headlineNet)}</b> net of
            renovation cost.
          </p>

          {/* Neighbourhood insight */}
          {v.insight && (
            <p className="text-xs text-muted-foreground">{v.insight}</p>
          )}

          {/* Recommended ledger rows */}
          {v.recommendedRows.length > 0 && (
            <div className="space-y-1.5">
              {v.recommendedRows.map((r) => (
                <Row key={r.key} row={r} />
              ))}
            </div>
          )}

          {/* "Other moves" disclosure */}
          {(v.moreRows.length > 0 || v.suppressed.length > 0) && (
            <details>
              <summary className="cursor-pointer list-none text-xs text-cyan-700 hover:text-cyan-600 dark:text-cyan-400 dark:hover:text-cyan-300">
                Other moves
              </summary>
              <div className="mt-2 space-y-1.5">
                {v.moreRows.map((r) => (
                  <Row key={r.key} row={r} />
                ))}
                {v.suppressed.map((s) => (
                  <div key={s.key} className="flex justify-between gap-2 text-xs">
                    <span className="truncate text-muted-foreground">{s.label}</span>
                    <span className="shrink-0 text-right text-muted-foreground">{s.reason}</span>
                  </div>
                ))}
              </div>
            </details>
          )}

          {/* Basis footer */}
          <p className="text-[10px] text-muted-foreground">{v.basis}</p>
        </div>
      ) : report ? (
        /* report exists but no priced moves */
        <p className="border-t border-border pt-4 text-xs text-muted-foreground">
          Renovation modeling isn&apos;t available for this neighbourhood yet.
        </p>
      ) : null}

      {/* ── Lead CTA — route to the live properties surface (no /contact route) ── */}
      <div className="space-y-2 border-t border-border pt-4">
        <Link
          href="/properties"
          className="flex min-h-[44px] w-full items-center justify-center gap-1 rounded-md bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 active:bg-emerald-700 [touch-action:manipulation]"
        >
          Book a free call →
        </Link>
        <p className="text-center text-[11px] text-muted-foreground">
          See active listings and talk to an investor agent — free, no obligation.
        </p>
      </div>

      {/* ── Always render compliance disclaimers ── */}
      <Disclaimers />
    </div>
  );
}
