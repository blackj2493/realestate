/**
 * SaleHistorySection — prior-sale ledger for one physical property.
 *
 * Renders the recorded sold campaigns (Date · List · Sold · Type) from the
 * precomputed property_sale_history table. Sold prices/dates are VOW data
 * (CLAUDE.md §4): for anonymous users the rows are blurred behind a sign-in CTA,
 * and the underlying values are never sent to the client (stripped server-side —
 * see gateSaleHistory). Authenticated users see the full ledger.
 */

"use client";

import { History } from "lucide-react";
import { cn, formatPrice } from "@/lib/utils";
import type { SaleHistory } from "@/lib/property/getListingDetail";
import { Redact, UnlockCta } from "@/components/Property/teaserPrimitives";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  // Date-only strings parse as UTC midnight — without timeZone:'UTC' Ontario viewers
  // see the previous day (audit MEDIUM-18).
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

function HeaderRow() {
  return (
    <tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
      <th className="py-2 text-left font-medium">Date</th>
      <th className="py-2 text-right font-medium">List</th>
      <th className="py-2 text-right font-medium">Sold</th>
      <th className="py-2 text-right font-medium">Type</th>
    </tr>
  );
}

export default function SaleHistorySection({
  saleHistory,
  isAuthed,
  className,
}: {
  saleHistory: SaleHistory;
  isAuthed: boolean;
  className?: string;
}) {
  const Title = (
    <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-foreground">
      <History className="h-4 w-4 text-amber-700 dark:text-amber-400" />
      Sale History
      {saleHistory.saleCount > 0 && (
        <span className="ml-1 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
          {saleHistory.saleCount}
        </span>
      )}
    </h3>
  );

  // ── Empty: no recorded prior sales ──────────────────────────────────────────
  if (!saleHistory.available || saleHistory.saleCount === 0) {
    return (
      <div className={cn("rounded-lg border border-border bg-card p-4", className)}>
        {Title}
        <p className="text-xs text-muted-foreground">No recorded prior sales for this address.</p>
      </div>
    );
  }

  // ── Anonymous: redacted ledger + unlock CTA ──────────────────────────────────
  if (!isAuthed) {
    const n = Math.min(saleHistory.saleCount, 5);
    return (
      <div className={cn("rounded-lg border border-cyan-500/40 bg-card p-4", className)}>
        {Title}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <HeaderRow />
            </thead>
            <tbody>
              {Array.from({ length: n }).map((_, i) => (
                <tr key={i} className="border-b border-border/50">
                  <td className="py-2 text-left"><Redact className="h-3 w-20" /></td>
                  <td className="py-2 text-right"><Redact className="h-3 w-16" /></td>
                  <td className="py-2 text-right"><Redact className="h-3 w-16" /></td>
                  <td className="py-2 text-right"><Redact className="h-3 w-10" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <UnlockCta
          label="Sign in to view sold prices — free"
          note={`${saleHistory.saleCount} prior sale${
            saleHistory.saleCount > 1 ? "s" : ""
          } on record · Sold data via TRREB VOW, for personal, non-commercial use.`}
        />
      </div>
    );
  }

  // ── Authenticated: full ledger ───────────────────────────────────────────────
  return (
    <div className={cn("rounded-lg border border-border bg-card p-4", className)}>
      {Title}
      <table className="w-full text-sm">
        <thead>
          <HeaderRow />
        </thead>
        <tbody className="divide-y divide-border/50">
          {saleHistory.events.map((e, i) => (
            <tr key={`${e.listing_key}-${i}`} className="font-mono text-xs">
              <td className="py-2 text-left text-foreground">{fmtDate(e.contract_date || e.close_date)}</td>
              <td className="py-2 text-right text-muted-foreground">
                {e.list_price ? formatPrice(e.list_price) : "—"}
              </td>
              <td className="py-2 text-right text-amber-700 dark:text-amber-400">
                {e.close_price ? formatPrice(e.close_price) : "—"}
              </td>
              <td className="py-2 text-right text-muted-foreground">{e.sub_type || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-[10px] leading-snug text-muted-foreground">
        Sold data via TRREB VOW — for your personal, non-commercial use.
      </p>
    </div>
  );
}
