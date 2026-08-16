/**
 * Sale-record hero + property-history ledger for /address pages (HouseSigma-style).
 *
 * CONSUMER-ONLY: renders VOW Listing Information (sold prices/dates/brokerages).
 * Mount solely inside a getConsumer()-confirmed branch — the anonymous path keeps
 * its existing redacted teaser and must never receive a SaleRecord.
 *
 * The campaign rail renders ONLY real, dated events (listed / price change /
 * sold) — nodes without a date are dropped, and the rail hides entirely below
 * two dated nodes rather than guessing.
 */
import type { SaleRecord, LatestSale, SaleCampaignRow } from "@/lib/address/saleRecord";

const fmtMoney = (n: number) => `$${Math.round(n).toLocaleString("en-CA")}`;

/** Close price with the lease unit — a leased "close" is monthly rent. */
const fmtClose = (n: number, kind: "sold" | "leased") => (kind === "leased" ? `${fmtMoney(n)}/mo` : fmtMoney(n));

/** Date-only ISO → "Jun 18, 2026". UTC keeps the day server-TZ-independent (MEDIUM-18). */
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "—";
  return new Date(ms).toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

function fmtDateShort(iso: string): string {
  const ms = Date.parse(iso);
  return new Date(ms).toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: "UTC" });
}

function fmtPct(pct: number): string {
  const v = Math.abs(pct).toFixed(1).replace(/\.0$/, "");
  return pct >= 0 ? `+${v}%` : `−${v}%`;
}

/** Over/under-ask verdict chip — buyer's lens: emerald under ask, amber over (comps-ledger convention). */
function AskDelta({ pct }: { pct: number }) {
  const over = pct > 0;
  return (
    <span
      className={`rounded px-2 py-0.5 font-mono text-xs font-bold ${
        over
          ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
          : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
      }`}
    >
      {fmtPct(pct)} {over ? "over" : "under"} ask
    </span>
  );
}

const ROW_CHIP: Record<SaleCampaignRow["kind"], { label: string; cls: string }> = {
  sold: { label: "SOLD", cls: "bg-rose-500/15 text-rose-700 dark:text-rose-400" },
  leased: { label: "LEASED", cls: "bg-sky-500/15 text-sky-700 dark:text-sky-400" },
  terminated: { label: "TERMINATED", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
  expired: { label: "EXPIRED", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
  suspended: { label: "SUSPENDED", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
  active: { label: "ACTIVE", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
};

/** Campaign rail: listed → (price change) → sold, evenly spaced. Real dated events only. */
function CampaignRail({ sale }: { sale: LatestSale }) {
  const endLabel = sale.kind === "leased" ? "Leased" : "Sold";
  const nodes: Array<{ label: string; iso: string; price: number | null; terminal?: boolean }> = [];
  if (sale.entryDateISO) nodes.push({ label: "Listed", iso: sale.entryDateISO, price: sale.originalAsk ?? sale.askAtSale });
  if (sale.originalAsk !== null && sale.priceChangeDateISO)
    nodes.push({ label: "Price change", iso: sale.priceChangeDateISO, price: sale.askAtSale });
  nodes.push({ label: endLabel, iso: sale.endDateISO, price: sale.closePrice, terminal: true });
  if (nodes.length < 2) return null;

  return (
    <div className="mt-5 flex" aria-label="Campaign timeline">
      {nodes.map((n, i) => (
        <div key={`${n.label}-${n.iso}`} className="flex min-w-0 flex-1 flex-col items-center">
          <div className="flex w-full items-center">
            <div className={`h-px flex-1 ${i === 0 ? "bg-transparent" : "bg-border"}`} />
            <span
              className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                n.terminal ? "bg-rose-500 ring-4 ring-rose-500/15" : "bg-muted-foreground/60"
              }`}
            />
            <div className={`h-px flex-1 ${i === nodes.length - 1 ? "bg-transparent" : "bg-border"}`} />
          </div>
          <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {n.label} · {fmtDateShort(n.iso)}
          </p>
          {n.price !== null && n.price > 0 && (
            <p className="font-mono text-xs font-semibold text-foreground">{fmtClose(n.price, sale.kind)}</p>
          )}
        </div>
      ))}
    </div>
  );
}

function Fact({ k, v, tone }: { k: string; v: string; tone?: "up" | "down" }) {
  const toneCls =
    tone === "up"
      ? "text-emerald-700 dark:text-emerald-400"
      : tone === "down"
        ? "text-rose-700 dark:text-rose-400"
        : "text-foreground";
  return (
    <div className="border-r border-border pr-5 last:border-r-0 last:pr-0">
      <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{k}</p>
      <p className={`mt-0.5 font-mono text-sm font-semibold tabular-nums ${toneCls}`}>{v}</p>
    </div>
  );
}

function Hero({ sale }: { sale: LatestSale }) {
  return (
    <section className="rounded-lg border border-border bg-card/40 p-5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="font-mono text-3xl font-bold tabular-nums text-foreground sm:text-4xl">
          {fmtClose(sale.closePrice, sale.kind)}
        </p>
        {sale.askAtSale !== null && sale.askAtSale > 0 && (
          <p className="font-mono text-sm text-muted-foreground">
            asked <s className="decoration-muted-foreground/60">{fmtClose(sale.askAtSale, sale.kind)}</s>
          </p>
        )}
        {sale.overAskPct !== null && <AskDelta pct={sale.overAskPct} />}
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {sale.kind === "leased" ? "Leased" : "Sold"} {fmtDate(sale.endDateISO)}
      </p>

      {(sale.domDays !== null || sale.gain !== null) && (
        <div className="mt-4 flex flex-wrap gap-5 border-t border-border pt-4">
          {sale.domDays !== null && <Fact k="Days on market" v={`${sale.domDays}d`} />}
          {sale.gain !== null && (
            <Fact
              k={`Vs ${fmtDate(sale.prevSale!.endDateISO)} sale`}
              v={`${sale.gain >= 0 ? "+" : "−"}${fmtMoney(Math.abs(sale.gain))}`}
              tone={sale.gain >= 0 ? "up" : "down"}
            />
          )}
          {sale.annualizedPct !== null && (
            <Fact
              k="Appreciation"
              v={`≈${fmtPct(sale.annualizedPct).replace("+", "")}/yr`}
              tone={sale.annualizedPct >= 0 ? "up" : "down"}
            />
          )}
        </div>
      )}

      <CampaignRail sale={sale} />

      {/* TRREB §6.3(c): brokerage shown with the listing details. */}
      {sale.brokerage && <p className="mt-4 text-sm text-muted-foreground">Listed by {sale.brokerage}</p>}
    </section>
  );
}

function HistoryRow({ row }: { row: SaleCampaignRow }) {
  const chip = ROW_CHIP[row.kind];
  const isClosed = row.kind === "sold" || row.kind === "leased";
  const closeUnit = row.kind === "leased" ? "leased" : "sold";
  const ask = row.listPrice ?? row.originalListPrice;
  const deltaPct =
    isClosed && (row.closePrice ?? 0) > 0 && ask && ask > 0 ? ((row.closePrice! - ask) / ask) * 100 : null;
  const what = [
    ask && ask > 0 ? `Asked ${row.kind === "leased" ? `${fmtMoney(ask)}/mo` : fmtMoney(ask)}` : null,
    isClosed && row.domDays !== null
      ? `${closeUnit} in ${row.domDays} day${row.domDays === 1 ? "" : "s"}`
      : !isClosed && row.kind !== "active" && row.domDays !== null
        ? `${row.kind} after ${row.domDays} day${row.domDays === 1 ? "" : "s"}`
        : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-t border-border px-4 py-3 first:border-t-0">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-wider ${chip.cls}`}>
            {chip.label}
          </span>
          <span className="font-mono text-xs text-muted-foreground">{fmtDate(row.endDateISO ?? row.entryDateISO)}</span>
        </div>
        {what && <p className="mt-1 text-sm text-foreground">{what}</p>}
        {/* Details + brokerage share one type tier — §6.3: no visual de-emphasis. */}
        <p className="mt-0.5 font-mono text-xs text-muted-foreground">
          MLS# {row.listingKey}
          {row.brokerage ? ` · ${row.brokerage}` : ""}
        </p>
      </div>
      <div className="text-right">
        {(row.closePrice ?? 0) > 0 ? (
          <>
            <p className="font-mono text-sm font-bold tabular-nums text-foreground">
              {row.kind === "leased" ? `${fmtMoney(row.closePrice!)}/mo` : fmtMoney(row.closePrice!)}
            </p>
            {deltaPct !== null && (
              <p
                className={`font-mono text-[10px] ${
                  deltaPct > 0
                    ? "text-amber-700 dark:text-amber-400"
                    : "text-emerald-700 dark:text-emerald-400"
                }`}
              >
                {fmtPct(deltaPct)} {deltaPct > 0 ? "over" : "under"} ask
              </p>
            )}
          </>
        ) : (
          <p className="font-mono text-sm text-muted-foreground">—</p>
        )}
      </div>
    </div>
  );
}

/**
 * The full record: hero (when a closed sale/lease exists) + every campaign.
 * Renders nothing when the record is empty — callers can mount unconditionally.
 */
export default function SaleRecordCard({ record }: { record: SaleRecord | null }) {
  if (!record || record.campaignCount === 0) return null;
  const { latestSale, campaigns } = record;
  return (
    <div className="space-y-4">
      {latestSale && <Hero sale={latestSale} />}
      <section id="history" className="overflow-hidden rounded-lg border border-border bg-card/40">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground">
            Property history
            <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">
              {record.campaignCount} campaign{record.campaignCount === 1 ? "" : "s"}
            </span>
          </h2>
          {latestSale?.gain !== null && latestSale?.gain !== undefined && latestSale.prevSale && (
            <p
              className={`font-mono text-xs font-semibold ${
                latestSale.gain >= 0
                  ? "text-emerald-700 dark:text-emerald-400"
                  : "text-rose-700 dark:text-rose-400"
              }`}
            >
              {latestSale.gain >= 0 ? "▲" : "▼"} {fmtMoney(Math.abs(latestSale.gain))} since{" "}
              {fmtDate(latestSale.prevSale.endDateISO)}
            </p>
          )}
        </div>
        {campaigns.map((row) => (
          <HistoryRow key={row.listingKey} row={row} />
        ))}
      </section>
    </div>
  );
}
