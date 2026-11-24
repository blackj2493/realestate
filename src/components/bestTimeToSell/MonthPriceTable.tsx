/**
 * The 12-month table of /data/best-time-to-sell/{city}: price against the average month (with
 * a small diverging bar from the centre line), days on market, sale-to-asking and the share
 * over asking. Server component; every number is plain text. The bar colour carries no
 * meaning beyond direction, which the signed number also states; a not-significant month is
 * drawn lighter and marked *.
 */
import { MONTH_NAMES, signedPct, type MonthStats } from "@/lib/data/bestTimeToSell";

export default function MonthPriceTable({ months }: { months: MonthStats[] }) {
  const max = Math.max(1, ...months.map((m) => Math.abs(m.price?.pct ?? 0)));
  return (
    <table className="w-full min-w-[36rem] text-sm">
      <thead>
        <tr className="border-b border-border text-left text-muted-foreground">
          <th className="py-2 pr-3 font-medium">Month</th>
          <th className="py-2 pr-3 font-medium">Price vs average month</th>
          <th className="py-2 pr-3 text-right font-medium">Days on market</th>
          <th className="py-2 pr-3 text-right font-medium">Sale to asking</th>
          <th className="py-2 pr-3 text-right font-medium">Over asking</th>
          <th className="py-2 text-right font-medium">Sales</th>
        </tr>
      </thead>
      <tbody>
        {months.map((m) => {
          const p = m.price;
          const w = p ? (Math.abs(p.pct) / max) * 50 : 0;
          return (
            <tr key={m.month} className="border-b border-border/60">
              <td className="py-2 pr-3">{MONTH_NAMES[m.month - 1]}</td>
              <td className="py-2 pr-3">
                {p ? (
                  <div className="flex items-center gap-2">
                    <div className="relative h-2.5 w-24 shrink-0 rounded-sm bg-muted" aria-hidden="true">
                      <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
                      <div
                        className={`absolute inset-y-0 rounded-sm ${p.pct >= 0 ? "bg-teal-600 dark:bg-teal-400" : "bg-slate-500 dark:bg-slate-400"} ${p.significant ? "" : "opacity-40"}`}
                        style={p.pct >= 0 ? { left: "50%", width: `${w}%` } : { right: "50%", width: `${w}%` }}
                      />
                    </div>
                    <span className="tabular-nums">
                      {signedPct(p.pct)}
                      {p.significant ? "" : "*"}
                    </span>
                  </div>
                ) : (
                  "–"
                )}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums">{m.medianDom ?? "–"}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{m.saleToAsk != null ? `${m.saleToAsk.toFixed(1)}%` : "–"}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{m.overAskShare != null ? `${m.overAskShare}%` : "–"}</td>
              <td className="py-2 text-right tabular-nums">{m.sales.toLocaleString("en-CA")}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
