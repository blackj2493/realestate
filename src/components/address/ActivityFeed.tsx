/**
 * ActivityFeed — "the last 30 days around this home". Mixes asking-side events
 * (NEW / CUT — IDX, public) with sold events.
 *
 * VOW gate: consumer callers pass real `soldEvents`; anonymous callers pass an empty
 * array and the ANON render inserts pure-placeholder locked rows (redact-skeleton
 * blocks — no address, price, or date is present in props OR the DOM, matching the
 * market-activity route, which withholds even sold addresses from anon). The count
 * teaser is the one sold-derived number anon sees (established pattern).
 */
import Link from "next/link";
import { Lock } from "lucide-react";
import type { ActiveEvent } from "@/lib/address/nearbyForSale";
import type { SoldNearEvent } from "@/lib/address/soldNearPoint";

const MAX_ROWS = 10;
const DAY_MS = 86_400_000;

function relDays(ms: number): string {
  const d = Math.floor((Date.now() - ms) / DAY_MS);
  return d <= 0 ? "today" : `${d}d ago`;
}

function fmtPrice(n: number): string {
  return `$${Math.round(n).toLocaleString("en-CA")}`;
}

function fmtSoldDate(ms: number): string {
  // Epoch encodes a date-only value at UTC midnight — timeZone:'UTC' keeps the rendered
  // day correct for Ontario (UTC−) viewers (audit MEDIUM-18).
  return new Date(ms).toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: "UTC" });
}

type Row =
  | { kind: "new" | "cut"; sortMs: number; ev: ActiveEvent }
  | { kind: "sold"; sortMs: number; sold: SoldNearEvent }
  | { kind: "locked"; sortMs: number };

// Per-kind left accent rail — the at-a-glance colour cue so NEW / CUT / SOLD read
// apart before you parse the row. Pairs with the Badge label (which names the event).
const ROW_ACCENT: Record<"new" | "cut" | "sold" | "locked", string> = {
  new: "border-l-cyan-500/70 hover:bg-cyan-500/[0.06]",
  cut: "border-l-amber-500/70 hover:bg-amber-500/[0.06]",
  sold: "border-l-emerald-500/70 hover:bg-emerald-500/[0.06]",
  locked: "border-l-emerald-500/30 hover:bg-emerald-500/[0.05]",
};
const ROW_BASE =
  "flex items-center gap-3 rounded-r-md border-l-2 py-2.5 pl-3 pr-1 transition-colors";

function Badge({ kind }: { kind: "new" | "cut" | "sold" }) {
  const cls =
    kind === "new"
      ? "bg-cyan-500/12 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-400"
      : kind === "cut"
        ? "bg-amber-500/12 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400"
        : "bg-emerald-500/12 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400";
  return (
    <span className={`w-12 shrink-0 rounded py-1 text-center font-mono text-[9px] font-bold tracking-wider ${cls}`}>
      {kind.toUpperCase()}
    </span>
  );
}

function Thumb({ url, alt }: { url: string | null; alt: string }) {
  return (
    <div className="h-10 w-14 shrink-0 overflow-hidden rounded bg-muted">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- MLS photos are never optimized (cost + TRREB watermark)
        <img src={url} alt={alt} loading="lazy" className="h-full w-full object-cover" />
      ) : null}
    </div>
  );
}

export default function ActivityFeed({
  activeEvents,
  soldEvents,
  soldCount30,
  isConsumer,
  radiusKm,
}: {
  activeEvents: ActiveEvent[];
  /** CONSUMER ONLY — anonymous callers must pass []. */
  soldEvents: SoldNearEvent[];
  soldCount30: number;
  isConsumer: boolean;
  radiusKm: number;
}) {
  const rows: Row[] = [
    ...activeEvents.map<Row>((ev) => ({
      kind: ev.kind,
      // Cuts carry no event date on the doc — sort on campaign entry (conservative).
      sortMs: ev.listing.entryMs ?? 0,
      ev,
    })),
    ...soldEvents.map<Row>((sold) => ({ kind: "sold", sortMs: sold.soldDateMs, sold })),
  ].sort((a, b) => b.sortMs - a.sortMs);

  let visible = rows.slice(0, MAX_ROWS);

  // Anonymous: interleave pure-placeholder locked rows so the gate is visible IN the
  // feed (2 max). Placeholders carry no data whatsoever.
  if (!isConsumer && soldCount30 > 0 && visible.length > 0) {
    const lockedCount = Math.min(2, soldCount30);
    const withLocked: Row[] = [...visible];
    withLocked.splice(1, 0, { kind: "locked", sortMs: 0 });
    if (lockedCount > 1 && withLocked.length > 4) withLocked.splice(4, 0, { kind: "locked", sortMs: 0 });
    visible = withLocked.slice(0, MAX_ROWS + lockedCount);
  }

  if (visible.length === 0 && soldCount30 === 0) return null;

  return (
    <section className="rounded-lg border border-border bg-card/40 p-5">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-foreground">
          The last 30 days around this home
        </h2>
        <span className="font-mono text-[10px] text-muted-foreground">{radiusKm} km · newest first</span>
      </div>

      <div className="space-y-1">
        {visible.map((row, i) => {
          if (row.kind === "locked") {
            return (
              <Link key={`locked-${i}`} href="/login" className={`group ${ROW_BASE} ${ROW_ACCENT.locked}`}>
                <Badge kind="sold" />
                <div className="redact-skeleton h-10 w-14 shrink-0 rounded" aria-hidden="true" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="redact-skeleton h-3 w-2/5 rounded" aria-hidden="true" />
                  <p className="flex items-center gap-1.5 font-mono text-[10px] text-emerald-700 group-hover:underline dark:text-emerald-400">
                    <Lock className="h-3 w-3" /> price unlocks with a free account
                  </p>
                </div>
                <div className="redact-skeleton h-4 w-16 shrink-0 rounded" aria-hidden="true" />
              </Link>
            );
          }
          if (row.kind === "sold") {
            const s = row.sold;
            return (
              <div key={`sold-${s.id}`} className={`${ROW_BASE} ${ROW_ACCENT.sold}`}>
                <Badge kind="sold" />
                <Thumb url={s.imageUrl} alt={s.address} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">{s.address}</p>
                  {/* Brokerage at the same tier as details — TRREB §6.3(c). */}
                  <p className="truncate font-mono text-[10px] text-muted-foreground">
                    {[s.subType, s.beds ? `${s.beds} bd` : null, s.baths ? `${s.baths} ba` : null, s.brokerage ?? "Brokerage unavailable"]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-mono text-sm font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
                    {fmtPrice(s.closePrice)}
                  </p>
                  <p className="font-mono text-[10px] text-muted-foreground">{fmtSoldDate(s.soldDateMs)}</p>
                </div>
              </div>
            );
          }
          const l = row.ev.listing;
          const isCut = row.kind === "cut";
          return (
            <Link
              key={`${row.kind}-${l.id}`}
              href={`/properties/${l.id}`}
              className={`group ${ROW_BASE} ${ROW_ACCENT[row.kind]}`}
            >
              <Badge kind={row.kind} />
              <Thumb url={l.imageUrl} alt={l.address} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-foreground group-hover:text-cyan-700 dark:group-hover:text-cyan-400">
                  {l.address}
                </p>
                <p className="truncate font-mono text-[10px] text-muted-foreground">
                  {[
                    l.subType,
                    l.beds ? `${l.beds} bd` : null,
                    l.baths ? `${l.baths} ba` : null,
                    isCut ? `was ${fmtPrice(l.price + l.dropAmount)}` : null,
                    l.brokerage ?? "Brokerage unavailable",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p
                  className={`font-mono text-sm font-bold tabular-nums ${
                    isCut ? "text-amber-700 dark:text-amber-400" : "text-foreground"
                  }`}
                >
                  {isCut ? `−${fmtPrice(l.dropAmount)}` : fmtPrice(l.price)}
                </p>
                <p className="font-mono text-[10px] text-muted-foreground">
                  {isCut ? (l.dom !== null ? `${l.dom}d on market` : "price cut") : l.entryMs ? relDays(l.entryMs) : ""}
                </p>
              </div>
            </Link>
          );
        })}
      </div>

      {!isConsumer && soldCount30 > 0 && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3.5">
          <p className="text-xs text-muted-foreground">
            <b className="font-semibold text-foreground">
              {soldCount30} sale{soldCount30 === 1 ? "" : "s"}
            </b>{" "}
            happened here this month. Members see every price.
          </p>
          <Link
            href="/register"
            className="inline-flex h-9 items-center rounded-md bg-emerald-500 px-4 text-xs font-bold uppercase tracking-wider text-slate-950 transition-colors hover:bg-emerald-400"
          >
            Create free account
          </Link>
        </div>
      )}
    </section>
  );
}
