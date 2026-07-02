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

import Link from "next/link";
import { History, Lock } from "lucide-react";
import { cn, formatPrice } from "@/lib/utils";
import type { SaleHistory } from "@/lib/property/getListingDetail";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
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
      <History className="h-4 w-4 text-amber-600 dark:text-amber-400" />
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

  // ── Anonymous: blurred placeholder rows + sign-in CTA ────────────────────────
  if (!isAuthed) {
    const placeholders = Array.from({ length: Math.min(saleHistory.saleCount, 5) });
    return (
      <div className={cn("rounded-lg border border-border bg-card p-4", className)}>
        {Title}
        <div className="relative">
          <table className="w-full text-sm" aria-hidden="true">
            <thead>
              <HeaderRow />
            </thead>
            <tbody className="select-none blur-sm">
              {placeholders.map((_, i) => (
                <tr key={i} className="border-b border-border/40 font-mono text-xs text-muted-foreground">
                  <td className="py-2 text-left">2023 ··· ··</td>
                  <td className="py-2 text-right">$•,•••,•••</td>
                  <td className="py-2 text-right">$•,•••,•••</td>
                  <td className="py-2 text-right">····</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded bg-background/50 backdrop-blur-[1px]">
            <Lock className="h-5 w-5 text-primary" />
            <p className="text-xs text-foreground">
              {saleHistory.saleCount} prior sale{saleHistory.saleCount > 1 ? "s" : ""} on record
            </p>
            <Link
              href="/login"
              className="rounded border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
            >
              Sign in to view sold prices
            </Link>
          </div>
        </div>
        <p className="mt-3 text-[10px] leading-snug text-muted-foreground">
          Sold data via TRREB VOW — viewable to signed-in users for personal, non-commercial use.
        </p>
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
              <td className="py-2 text-right text-amber-600 dark:text-amber-400">
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
