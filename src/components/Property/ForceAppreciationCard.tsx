import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPrice } from "@/lib/utils";
import type { ValueAddReport } from "@/lib/avm/valueAdd/types";
import { shouldRender, buildView, type LedgerRow } from "./forceAppreciationView";
import VowGateOverlay from "@/components/auth/VowGateOverlay";

const SCORE_LEGEND =
  "Upside = how much equity you could unlock by renovating, as an index relative to this home's value (before cost).";
const COLS = "grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-3";

function ColumnHeader() {
  return (
    <div className={`${COLS} text-[10px] uppercase tracking-wide text-muted-foreground`}>
      <span />
      <span className="text-right">Adds</span>
      <span className="text-right">Costs</span>
      <span className="w-10 text-right">Return</span>
    </div>
  );
}

function LedgerRowView({ row }: { row: LedgerRow }) {
  return (
    <div className={`${COLS} text-xs`}>
      <span className="text-foreground leading-tight">{row.label}</span>
      <span className="text-right font-mono text-emerald-600 dark:text-emerald-400">+{formatPrice(row.valueTyp)}</span>
      <span className="text-right font-mono text-muted-foreground">−{formatPrice(row.costTyp)}</span>
      <span className="w-10 text-right font-mono text-muted-foreground">
        {Number.isFinite(row.payback) ? row.payback.toFixed(1) : "—"}×
      </span>
    </div>
  );
}

export default function ForceAppreciationCard({
  report,
  locked,
}: {
  report: ValueAddReport | null;
  /** VOW gate: Value-Add is AVM-derived — render a blurred "Login Required" teaser for anon. */
  locked?: boolean;
}) {
  if (locked) {
    return (
      <Card data-tour="listing-force-appreciation">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>Renovation Upside</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="relative">
            <div className="space-y-2 blur-sm select-none" aria-hidden="true">
              <p className="text-sm">
                <span className="text-muted-foreground">up to </span>
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">$000,000</span>
                <span className="text-muted-foreground"> unlockable · ~$000,000 net after cost</span>
              </p>
              <div className="h-3 w-full rounded bg-muted/40" />
              <div className="h-3 w-2/3 rounded bg-muted/40" />
            </div>
            <VowGateOverlay message="Sign in to view value-add ROI" />
          </div>
        </CardContent>
      </Card>
    );
  }
  if (!shouldRender(report)) return null;
  const v = buildView(report);
  const hasRecommended = v.recommendedRows.length > 0;

  return (
    <Card data-tour="listing-force-appreciation">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>Renovation Upside</CardTitle>
        <span
          title={SCORE_LEGEND}
          className="cursor-help rounded border border-transparent bg-emerald-600 px-2 py-0.5 font-mono text-xs font-bold text-white shadow-sm dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
        >
          Upside {v.score}/100
        </span>
      </CardHeader>
      <CardContent className="space-y-3">
        {hasRecommended && (
          <p className="text-[15px]">
            <span className="text-muted-foreground">up to </span>
            <span className="text-lg font-extrabold text-emerald-700 dark:text-emerald-400">{formatPrice(v.headlineGross)}</span>
            <span className="text-muted-foreground"> unlockable · ~</span>
            <span className="text-lg font-extrabold text-emerald-700 dark:text-emerald-400">{formatPrice(v.headlineNet)}</span>
            <span className="text-muted-foreground"> net after cost</span>
          </p>
        )}

        {v.insight && <p className="text-xs text-muted-foreground">{v.insight}</p>}

        {hasRecommended && (
          <div className="space-y-1.5">
            <ColumnHeader />
            {v.recommendedRows.map((r) => (
              <LedgerRowView key={r.key} row={r} />
            ))}
            {/* Total summary line (not the column grid): the net is labelled so it
                is never read as a Return × value. */}
            <div className="flex items-center justify-between gap-2 border-t border-border pt-1 text-xs font-semibold">
              <span className="text-muted-foreground">Total</span>
              <span className="font-mono">
                <span className="text-emerald-600 dark:text-emerald-400">+{formatPrice(v.headlineGross)}</span>{" "}
                <span className="text-muted-foreground">−{formatPrice(v.totalCosts)}</span>{" "}
                <span className="text-emerald-600 dark:text-emerald-400">= {formatPrice(v.headlineNet)} net</span>
              </span>
            </div>
          </div>
        )}

        {(v.moreRows.length > 0 || v.suppressed.length > 0) && (
          <details open={!hasRecommended}>
            <summary className="cursor-pointer list-none text-xs text-cyan-600 dark:text-cyan-400 hover:text-cyan-300">
              {hasRecommended ? "Why not the others?" : "Modeled moves (none pay back here)"}
            </summary>
            <div className="mt-2 space-y-1.5">
              {v.moreRows.length > 0 && <ColumnHeader />}
              {v.moreRows.map((r) => (
                <LedgerRowView key={r.key} row={r} />
              ))}
              {v.suppressed.map((s) => (
                <div key={s.key} className="text-xs leading-tight">
                  <span className="text-muted-foreground">{s.label}</span>
                  <span className="block text-muted-foreground">{s.reason}</span>
                </div>
              ))}
            </div>
          </details>
        )}

        <p className="text-[10px] text-muted-foreground">{v.basis}</p>
      </CardContent>
    </Card>
  );
}
