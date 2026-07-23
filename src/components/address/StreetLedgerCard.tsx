/**
 * StreetLedgerCard — every recorded sale on the subject's street, as a timeline.
 *
 * VOW gate is upstream and structural: anonymous callers receive ONLY
 * { streetLabel, count } (getStreetLedgerPublic) — the redacted dots below are pure
 * placeholders (redact-skeleton, evenly spaced, no year/price/date anywhere in the
 * DOM). Consumers receive the full ledger and get real dots positioned by date.
 */
import Link from "next/link";
import { Lock } from "lucide-react";
import type { StreetLedgerGated, StreetLedgerPublic } from "@/lib/address/streetLedger";

const MAX_DOTS = 10;

function fmtK(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 2)}M`;
  return `$${Math.round(n / 1000)}k`;
}

/** Date-only ISO string → UTC-safe year/short label (audit MEDIUM-18). */
function yearOf(dateISO: string): string {
  return dateISO.slice(0, 4);
}
function fmtDate(dateISO: string): string {
  const d = new Date(dateISO);
  return Number.isNaN(d.getTime())
    ? dateISO
    : d.toLocaleDateString("en-CA", { year: "numeric", month: "short", timeZone: "UTC" });
}

export default function StreetLedgerCard({
  isConsumer,
  gated,
  publicLedger,
}: {
  isConsumer: boolean;
  /** CONSUMER ONLY — anonymous callers must pass null. */
  gated: StreetLedgerGated | null;
  publicLedger: StreetLedgerPublic | null;
}) {
  const count = isConsumer ? (gated?.count ?? 0) : (publicLedger?.count ?? 0);
  const streetLabel = (isConsumer ? gated?.streetLabel : publicLedger?.streetLabel) ?? "";
  if (count === 0 || !streetLabel) return null;

  // ── Consumer: real timeline, dots positioned by sale date ──────────────────
  if (isConsumer && gated) {
    const sales = gated.sales.slice(0, MAX_DOTS); // newest first
    const times = sales.map((s) => new Date(s.dateISO).getTime()).filter((t) => Number.isFinite(t));
    const minT = Math.min(...times);
    const maxT = Math.max(...times);
    const span = Math.max(1, maxT - minT);
    const latest = gated.sales[0];
    return (
      <section className="rounded-lg border border-border bg-card/40 p-5">
        <div className="mb-1 flex items-baseline justify-between gap-3">
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-foreground">{streetLabel} ledger</h2>
          <span className="font-mono text-[10px] text-muted-foreground">
            {gated.count} sale{gated.count === 1 ? "" : "s"} on record
          </span>
        </div>

        <div className="relative mx-1 mb-9 mt-10 h-0.5 rounded bg-border" aria-hidden="true">
          {sales.map((s, i) => {
            const t = new Date(s.dateISO).getTime();
            const left = sales.length === 1 ? 50 : 4 + ((t - minT) / span) * 92;
            return (
              <span
                key={`${s.listingKey}-${i}`}
                className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-emerald-500"
                style={{ left: `${left}%` }}
                title={`${s.address} — ${fmtK(s.closePrice)} · ${fmtDate(s.dateISO)}`}
              >
                <span className="absolute -top-5 left-1/2 -translate-x-1/2 font-mono text-[9px] text-muted-foreground">
                  {yearOf(s.dateISO)}
                </span>
                <span className="absolute left-1/2 top-3.5 -translate-x-1/2 font-mono text-[9px] font-bold text-emerald-700 dark:text-emerald-400">
                  {fmtK(s.closePrice)}
                </span>
              </span>
            );
          })}
        </div>

        {latest && (
          <p className="text-xs text-muted-foreground">
            Latest: <b className="font-semibold text-foreground">{latest.address}</b> —{" "}
            <span className="font-mono text-emerald-700 dark:text-emerald-400">{fmtK(latest.closePrice)}</span> ·{" "}
            {fmtDate(latest.dateISO)}
            {gated.count > MAX_DOTS ? ` · +${gated.count - MAX_DOTS} earlier` : ""}
          </p>
        )}
        <p className="mt-2 text-[10px] leading-snug text-muted-foreground">
          Sold data via TRREB VOW — for your personal, non-commercial use.
        </p>
      </section>
    );
  }

  // ── Anonymous: count + pure-placeholder dots, sign-in CTA ──────────────────
  const dots = Math.min(count, 8);
  return (
    <section className="rounded-lg border border-border bg-card/40 p-5">
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-foreground">{streetLabel} ledger</h2>
        <span className="font-mono text-[10px] text-muted-foreground">
          {count} sale{count === 1 ? "" : "s"} on record
        </span>
      </div>

      <div className="relative mx-1 mb-8 mt-8 h-0.5 rounded bg-border" aria-hidden="true">
        {Array.from({ length: dots }).map((_, i) => (
          <span
            key={i}
            className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-emerald-500/80"
            style={{ left: `${dots === 1 ? 50 : 4 + (i / (dots - 1)) * 92}%` }}
          >
            <span className="redact-skeleton absolute left-1/2 top-3.5 h-2.5 w-7 -translate-x-1/2 rounded-sm" />
          </span>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        <b className="font-semibold text-foreground">
          {count} recorded sale{count === 1 ? "" : "s"}
        </b>{" "}
        on this street. Sign in free to read the whole ledger — every price, every date.
      </p>
      <Link
        href="/login"
        className="mt-3 inline-flex items-center gap-1.5 font-mono text-[11px] font-bold text-emerald-700 hover:underline dark:text-emerald-400"
      >
        <Lock className="h-3 w-3" /> Unlock the ledger
      </Link>
    </section>
  );
}
