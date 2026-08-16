import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPrice } from "@/lib/utils";
import type { ValueAddReport } from "@/lib/avm/valueAdd/types";
import { shouldRender, buildView, type LedgerRow } from "./forceAppreciationView";
import { Redact, UnlockCta } from "@/components/Property/teaserPrimitives";

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
      <span className="text-right font-mono text-emerald-700 dark:text-emerald-400">+{formatPrice(row.valueTyp)}</span>
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
    // Redacted ledger: the renovation MOVES we model are generic (not this home's
    // numbers), so showing them advertises the engine's depth without leaking value.
    const MOVES = ["Kitchen refresh", "Bathroom reno", "Finished basement", "Curb appeal"];
    return (
      <Card data-tour="listing-force-appreciation" className="border-cyan-500/40">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>Renovation Upside</CardTitle>
          <span className="flex items-center gap-1.5 rounded border border-border bg-muted/60 px-2 py-0.5 font-mono text-xs font-bold text-muted-foreground">
            Upside <Redact className="h-3 w-8" />
          </span>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
            up to <Redact className="h-4 w-20" /> unlockable · ~<Redact className="h-4 w-20" /> net after cost
          </p>
          <div className="space-y-1.5">
            <ColumnHeader />
            {MOVES.map((label) => (
              <div key={label} className={`${COLS} text-xs`}>
                <span className="leading-tight text-foreground">{label}</span>
                <span className="text-right">
                  <Redact className="h-3 w-12" />
                </span>
                <span className="text-right">
                  <Redact className="h-3 w-12" />
                </span>
                <span className="w-10 text-right">
                  <Redact className="h-3 w-8" />
                </span>
              </div>
            ))}
          </div>
          <UnlockCta
            label="See the renovation upside — free"
            note="Which renovations pay back here — added value, cost and ROI, from our Value-Add engine."
          />
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
                <span className="text-emerald-700 dark:text-emerald-400">+{formatPrice(v.headlineGross)}</span>{" "}
                <span className="text-muted-foreground">−{formatPrice(v.totalCosts)}</span>{" "}
                <span className="text-emerald-700 dark:text-emerald-400">= {formatPrice(v.headlineNet)} net</span>
              </span>
            </div>
          </div>
        )}

        {(v.moreRows.length > 0 || v.suppressed.length > 0) && (
          <details open={!hasRecommended}>
            <summary className="cursor-pointer list-none text-xs text-cyan-700 dark:text-cyan-400 hover:text-cyan-600 dark:hover:text-cyan-300">
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
