/**
 * CompsPopover — the ledger row's lightweight "comps peek". A small popover (not a full
 * mode-switch) showing the top 3 RANKED sold comps for that listing, with "See all on the
 * map" to escalate to the full comps view only when the user wants it. Sold prices are
 * VOW-gated server-side: anon callers get the count + a sign-in CTA, no rows.
 */
"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { X, Lock } from "lucide-react";
import type { ListingDocument } from "@/lib/typesense/client";
import { fetchSimilarComps, type SoldComp } from "@/lib/comps/fetchSimilarComps";

const money = (n: number): string =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : n >= 1_000 ? `$${Math.round(n / 1_000)}K` : `$${Math.round(n)}`;

function soldAgo(iso: string | null): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const d = Math.max(0, Math.round((Date.now() - t) / 86_400_000));
  return `sold ${d}d ago`;
}

interface State {
  loading: boolean;
  sold: SoldComp[];
  count: number;
  locked: boolean;
}

export default function CompsPopover({
  listing,
  onClose,
  onSeeAll,
}: {
  listing: ListingDocument;
  onClose: () => void;
  /** Escalate to the full map comps view (enterComps). */
  onSeeAll: () => void;
}) {
  const pathname = usePathname();
  const [s, setS] = React.useState<State>({ loading: true, sold: [], count: 0, locked: false });

  React.useEffect(() => {
    const ctrl = new AbortController();
    fetchSimilarComps(listing, ctrl.signal).then((r) => {
      if (ctrl.signal.aborted) return;
      if (!r) return setS({ loading: false, sold: [], count: 0, locked: false });
      setS({ loading: false, sold: r.sold.slice(0, 3), count: r.soldCount, locked: r.soldLocked });
    });
    return () => ctrl.abort();
  }, [listing]);

  const safeNext = pathname && pathname.startsWith("/") && !pathname.startsWith("//") ? pathname : null;
  const loginHref = safeNext ? `/login?next=${encodeURIComponent(safeNext)}` : "/login";

  return (
    <div
      // Stop row-level handlers (open listing / hover) from firing while interacting here.
      // Positioning is owned by the caller (LedgerRow) so it can sit clear of the columns.
      onClick={(e) => e.stopPropagation()}
      className="w-64 border border-border bg-card shadow-2xl shadow-black/60"
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        <span>Comparable sales · most similar</span>
        <button type="button" onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground">
          <X className="h-3 w-3" />
        </button>
      </div>

      {s.loading ? (
        <div className="px-3 py-3 font-mono text-[11px] text-muted-foreground">Scanning recent sales…</div>
      ) : s.locked ? (
        <Link href={loginHref} className="flex items-center gap-2 px-3 py-3 transition-colors hover:bg-muted/60">
          <Lock className="h-3.5 w-3.5 shrink-0 text-cyan-700 dark:text-cyan-300" />
          <span className="font-mono text-[11px] text-foreground">Sign in to view recent comparable solds</span>
        </Link>
      ) : s.sold.length === 0 ? (
        <div className="px-3 py-3 font-mono text-[11px] text-muted-foreground">No comparable solds nearby.</div>
      ) : (
        <>
          {s.sold.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2 last:border-b-0">
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-mono text-[11px] text-foreground">{c.address}</span>
                <span className="truncate font-mono text-[9px] text-muted-foreground">
                  {[c.propertySubType?.trim(), soldAgo(c.soldDate)].filter(Boolean).join(" · ")}
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end">
                <span className="font-mono text-[12px] font-bold text-rose-700 dark:text-rose-300">{money(c.closePrice)}</span>
                {c.pctOfAsk != null && (
                  <span className="font-mono text-[9px] text-muted-foreground">{Math.round(c.pctOfAsk)}% of ask</span>
                )}
              </span>
            </div>
          ))}
          <button
            type="button"
            onClick={onSeeAll}
            className="w-full bg-cyan-500/10 py-2 text-center font-mono text-[10px] font-semibold uppercase tracking-wider text-cyan-700 dark:text-cyan-300 transition-colors hover:bg-cyan-500/20"
          >
            See comparable sales on the map →
          </button>
        </>
      )}
    </div>
  );
}
