/**
 * StreetLedgerCard — every recorded sale on the subject's street, as a timeline.
 *
 * VOW gate is upstream and structural: anonymous callers receive ONLY
 * { streetLabel, count } (getStreetLedgerPublic) — the redacted dots below are pure
 * placeholders (redact-skeleton, evenly spaced, no year/price/date anywhere in the
 * DOM). Consumers receive the full ledger and get real dots positioned by date.
 */
import { Lock } from "lucide-react";
import SignInLink from "@/components/auth/SignInLink";
import type { StreetLedgerGated, StreetLedgerPublic } from "@/lib/address/streetLedger";

const MAX_DOTS = 10;

function fmtK(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 2)}M`;
  return `$${Math.round(n / 1000)}k`;
}

/** Date-only ISO string → UTC-safe month/year label (audit MEDIUM-18). */
function fmtDate(dateISO: string): string {
  const d = new Date(dateISO);
  return Number.isNaN(d.getTime())
    ? dateISO
    : d.toLocaleDateString("en-CA", { year: "numeric", month: "short", timeZone: "UTC" });
}

/** Street-level move vs the previous (older) recorded sale — an insight neither
 *  HouseSigma nor Realtor.ca surface inline. Different homes, so it's labelled as a
 *  street trajectory, never a same-home appreciation figure. */
function pctMove(cur: number, prev: number): { pct: number; up: boolean } | null {
  if (!Number.isFinite(prev) || prev <= 0) return null;
  const pct = ((cur - prev) / prev) * 100;
  if (!Number.isFinite(pct) || Math.abs(pct) < 0.5) return null;
  return { pct: Math.round(Math.abs(pct)), up: pct >= 0 };
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

  // ── Consumer: vertical timeline ledger, newest first ───────────────────────
  // A vertical rail (one row per sale) can't overlap the way the old date-proportional
  // horizontal dots did when sales clustered in the same period. Each row carries the
  // move vs the previous street sale — the added scannable insight.
  if (isConsumer && gated) {
    const sales = gated.sales.slice(0, MAX_DOTS); // newest first
    const prices = sales.map((s) => s.closePrice).filter((p) => Number.isFinite(p) && p > 0);
    const hi = prices.length ? Math.max(...prices) : 0;
    const lo = prices.length ? Math.min(...prices) : 0;
    const earlier = gated.count - sales.length;
    return (
      <section className="rounded-lg border border-border bg-card/40 p-5">
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-foreground">{streetLabel} ledger</h2>
          <span className="font-mono text-[10px] text-muted-foreground">
            {gated.count} sale{gated.count === 1 ? "" : "s"} on record
          </span>
        </div>

        <ol className="relative ml-1">
          {/* Continuous rail behind the dots. */}
          <span className="absolute bottom-3 left-[3px] top-3 w-px bg-border" aria-hidden="true" />
          {sales.map((s, i) => {
            const prev = sales[i + 1]; // the next-older street sale
            const move = prev ? pctMove(s.closePrice, prev.closePrice) : null;
            const isHi = s.closePrice === hi && hi !== lo;
            const isLo = s.closePrice === lo && hi !== lo;
            return (
              <li key={`${s.listingKey}-${i}`} className="relative flex items-center gap-3 py-2 pl-5">
                <span
                  className="absolute left-0 top-1/2 h-[7px] w-[7px] -translate-y-1/2 rounded-full border-2 border-card bg-emerald-500"
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">{s.address}</p>
                  <p className="font-mono text-[10px] text-muted-foreground">{fmtDate(s.dateISO)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2 text-right">
                  {move && (
                    <span
                      className={`font-mono text-[10px] font-semibold tabular-nums ${
                        move.up ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
                      }`}
                      title="vs the previous recorded sale on this street"
                    >
                      {move.up ? "▲" : "▼"}
                      {move.pct}%
                    </span>
                  )}
                  <span className="font-mono text-sm font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
                    {fmtK(s.closePrice)}
                  </span>
                  {(isHi || isLo) && (
                    <span
                      className={`w-8 shrink-0 rounded px-1 py-0.5 text-center font-mono text-[8px] font-bold uppercase tracking-wider ${
                        isHi
                          ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {isHi ? "High" : "Low"}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ol>

        {earlier > 0 && (
          <p className="mt-1 pl-5 font-mono text-[10px] text-muted-foreground">
            +{earlier} earlier sale{earlier === 1 ? "" : "s"} on record
          </p>
        )}
        <p className="mt-3 text-[10px] leading-snug text-muted-foreground">
          ▲/▼ is the street&apos;s move vs the previous recorded sale (different homes) — not a per-home appreciation
          figure. Sold data via TRREB VOW — for your personal, non-commercial use.
        </p>
      </section>
    );
  }

  // ── Anonymous: count + pure-placeholder rows, sign-in CTA ──────────────────
  const rows = Math.min(count, 5);
  return (
    <section className="rounded-lg border border-border bg-card/40 p-5">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-foreground">{streetLabel} ledger</h2>
        <span className="font-mono text-[10px] text-muted-foreground">
          {count} sale{count === 1 ? "" : "s"} on record
        </span>
      </div>

      <ol className="relative ml-1 mb-4" aria-hidden="true">
        <span className="absolute bottom-3 left-[3px] top-3 w-px bg-border" />
        {Array.from({ length: rows }).map((_, i) => (
          <li key={i} className="relative flex items-center gap-3 py-2 pl-5">
            <span className="absolute left-0 top-1/2 h-[7px] w-[7px] -translate-y-1/2 rounded-full border-2 border-card bg-emerald-500/70" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="redact-skeleton h-3 w-2/5 rounded" />
              <div className="redact-skeleton h-2.5 w-16 rounded" />
            </div>
            <div className="redact-skeleton h-4 w-14 shrink-0 rounded" />
          </li>
        ))}
      </ol>

      <p className="text-xs text-muted-foreground">
        <b className="font-semibold text-foreground">
          {count} recorded sale{count === 1 ? "" : "s"}
        </b>{" "}
        on this street. Sign in free to read the whole ledger — every price, every date.
      </p>
      <SignInLink className="mt-3 inline-flex items-center gap-1.5 font-mono text-[11px] font-bold text-emerald-700 hover:underline dark:text-emerald-400">
        <Lock className="h-3 w-3" /> Unlock the ledger
      </SignInLink>
    </section>
  );
}
