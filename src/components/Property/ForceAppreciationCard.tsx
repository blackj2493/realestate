import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPrice } from "@/lib/utils";
import type { ValueAddReport } from "@/lib/avm/valueAdd/types";
import { shouldRender, buildView, type LedgerRow } from "./forceAppreciationView";

function PaybackBar({ payback }: { payback: number }) {
  // Engine guarantees payback ∈ [0, ∞) finite; clamp anyway so this view stays
  // self-contained (a non-finite/negative payback can never paint an invalid width).
  const safe = Number.isFinite(payback) ? Math.max(0, payback) : 0;
  const pct = (Math.min(safe, 3) / 3) * 100;
  return (
    <span className="inline-block h-1.5 w-10 rounded bg-slate-700 align-middle">
      <span className="block h-full rounded bg-emerald-500" style={{ width: `${pct}%` }} />
    </span>
  );
}

function Row({ row }: { row: LedgerRow }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="truncate text-slate-300">{row.label}</span>
      <span className="flex shrink-0 items-center gap-2 font-mono">
        <span className="text-emerald-400">+{formatPrice(row.valueTyp)}</span>
        <span className="text-slate-500">−{formatPrice(row.costTyp)}</span>
        <PaybackBar payback={row.payback} />
        <span className="w-9 text-right text-slate-400">
          {Number.isFinite(row.payback) ? row.payback.toFixed(1) : "—"}×
        </span>
      </span>
    </div>
  );
}

export default function ForceAppreciationCard({ report }: { report: ValueAddReport | null }) {
  if (!shouldRender(report)) return null;
  const v = buildView(report);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>Force-Appreciation</CardTitle>
        <span className="rounded border border-emerald-700 bg-emerald-950/40 px-2 py-0.5 font-mono text-xs text-emerald-300">
          {v.score}/100
        </span>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm">
          <span className="text-slate-400">up to </span>
          <span className="font-semibold text-emerald-400">{formatPrice(v.headlineGross)}</span>
          <span className="text-slate-400"> unlockable · best net </span>
          <span className="font-semibold text-emerald-400">{formatPrice(v.headlineNet)}</span>
        </p>

        {v.insight && <p className="text-xs text-slate-400">{v.insight}</p>}

        <div className="space-y-1.5">
          {v.topRows.map((r) => (
            <Row key={r.key} row={r} />
          ))}
        </div>

        {(v.moreRows.length > 0 || v.suppressed.length > 0) && (
          <details>
            <summary className="cursor-pointer list-none text-xs text-cyan-400 hover:text-cyan-300">
              Why not the others?
            </summary>
            <div className="mt-2 space-y-1.5">
              {v.moreRows.map((r) => (
                <Row key={r.key} row={r} />
              ))}
              {v.suppressed.map((s) => (
                <div key={s.key} className="flex justify-between gap-2 text-xs">
                  <span className="truncate text-slate-400">{s.label}</span>
                  <span className="shrink-0 text-right text-slate-500">{s.reason}</span>
                </div>
              ))}
            </div>
          </details>
        )}

        <p className="text-[10px] text-slate-500">{v.basis}</p>
      </CardContent>
    </Card>
  );
}
