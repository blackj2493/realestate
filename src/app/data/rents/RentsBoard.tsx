"use client";

import { useCallback, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { RankingTable, type RankingColumn } from "@/components/data/RankingTable";
import {
  MOVER_MIN_SAMPLE,
  THIN_SAMPLE,
  type BedBand,
  type RentGroup,
  type RentRow,
} from "@/lib/data/rentBoard";

const DASH = "—";
const money = (v: number) => `$${v.toLocaleString("en-CA")}`;
const signed = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%`;

const BANDS: { key: BedBand; label: string }[] = [
  // Whole bedrooms — a den does NOT promote a home into the next band. See BEDS_EXPR
  // in refresh-rent-market-stats.ts for why, and the FAQ entry that says so publicly.
  { key: "1", label: "1 bed" },
  { key: "2", label: "2 bed" },
  { key: "3", label: "3 bed" },
  { key: "4", label: "4+ bed" },
  { key: "ALL", label: "All sizes" },
];

const GROUPS: { key: RentGroup; label: string; note: string }[] = [
  {
    key: "House",
    label: "Houses",
    note: "Detached, semi, townhouse, duplex and multiplex. TRREB's rental report covers condo apartments only; Door Insight publishes Toronto house rents. This is closed MLS® house leases across Ontario, by neighbourhood.",
  },
  {
    key: "Condo",
    label: "Condos",
    note: "Condo apartments, condo townhouses and co-ops. TRREB publishes a regional quarterly average; this is by neighbourhood, nightly, and median rather than mean.",
  },
];

function yoyClass(v: number) {
  return v > 0
    ? "text-[color:var(--dt-down)] dark:text-rose-400"
    : v < 0
      ? "text-[color:var(--dt-up)] dark:text-emerald-400"
      : "";
}

const columns: RankingColumn<RentRow>[] = [
  {
    key: "area",
    label: "Neighbourhood",
    align: "left",
    sortValue: (r) => r.area,
    render: (r) => (
      <div className="min-w-0">
        <div className="truncate font-semibold">{r.area}</div>
        {r.city && <div className="truncate text-[11px] text-muted-foreground">{r.city}</div>}
      </div>
    ),
  },
  {
    key: "medianRent",
    label: "Median Rent",
    align: "right",
    hint: "Median price the lease actually closed at — not the asking rent",
    sortValue: (r) => r.medianRent,
    render: (r) => <span className="font-semibold tabular-nums">{money(r.medianRent)}</span>,
  },
  {
    key: "yoyPct",
    label: "vs Last Year",
    align: "right",
    hint: "Same size, same neighbourhood, against the 12 months before. Blank where either period had under 20 leases.",
    sortValue: (r) => r.yoyPct,
    render: (r) =>
      r.yoyPct == null ? (
        <span className="text-muted-foreground" title="Not enough history for a reliable comparison">
          {DASH}
        </span>
      ) : (
        <span className={`font-semibold tabular-nums ${yoyClass(r.yoyPct)}`}>{signed(r.yoyPct)}</span>
      ),
  },
  {
    key: "spread",
    label: "Typical Range",
    align: "right",
    hint: "25th–75th percentile of closed rents",
    sortValue: (r) => r.p75Rent,
    render: (r) =>
      r.p25Rent == null || r.p75Rent == null ? (
        <span className="text-muted-foreground">{DASH}</span>
      ) : (
        <span className="tabular-nums text-muted-foreground">
          {money(r.p25Rent)}–{money(r.p75Rent)}
        </span>
      ),
  },
  {
    key: "sampleCount",
    label: "Leases",
    align: "right",
    hint: "Closed leases behind the figure, last 12 months",
    sortValue: (r) => r.sampleCount,
    // Thin rows are shown WITH their count rather than hidden — suppressing them would
    // quietly erase small towns — but marked so nobody reads one as solid.
    render: (r) => (
      <span
        className={`tabular-nums ${r.sampleCount < THIN_SAMPLE ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}
        title={r.sampleCount < THIN_SAMPLE ? "Thin sample — indicative only" : undefined}
      >
        ×{r.sampleCount}
      </span>
    ),
  },
];

/** The one-sentence finding, before any table. */
function Headline({ summary }: { summary: RentRow[] }) {
  const cell = (g: RentGroup, b: BedBand) => summary.find((r) => r.group === g && r.beds === b);
  return (
    <div className="mb-8 overflow-x-auto rounded-xl border border-border p-4 sm:p-5">
      <p className="terminal-font text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
        Ontario-wide · median closed rent · vs 12 months earlier
      </p>
      <table className="mt-3 w-full min-w-[520px] border-collapse text-sm">
        <thead>
          <tr>
            <th className="pb-2 text-left font-medium text-muted-foreground" />
            {BANDS.filter((b) => b.key !== "ALL").map((b) => (
              <th key={b.key} className="pb-2 text-right font-medium text-muted-foreground">
                {b.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {GROUPS.map((g) => (
            <tr key={g.key} className="border-t border-border">
              <td className="py-2.5 pr-3 font-semibold">{g.label}</td>
              {BANDS.filter((b) => b.key !== "ALL").map((b) => {
                const c = cell(g.key, b.key);
                return (
                  <td key={b.key} className="py-2.5 text-right">
                    {c ? (
                      <>
                        <div className="font-semibold tabular-nums">{money(c.medianRent)}</div>
                        {c.yoyPct != null && (
                          <div className={`text-[11px] tabular-nums ${yoyClass(c.yoyPct)}`}>
                            {signed(c.yoyPct)}
                          </div>
                        )}
                      </>
                    ) : (
                      <span className="text-muted-foreground">{DASH}</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Module scope, NOT nested inside Extremes. A component declared during render is a new
 * type on every render, so React unmounts and remounts it and any state resets — the
 * react-hooks/component-shape rule fails the build on it.
 */
function ExtremeCard({
  title,
  list,
  showYoy,
}: {
  title: string;
  list: RentRow[];
  showYoy?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border p-4">
      <p className="terminal-font text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
        {title}
      </p>
      <ol className="mt-2.5 space-y-1.5">
        {list.map((r) => (
          <li key={`${r.city}|${r.area}`} className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate">{r.area}</span>
            <span className="shrink-0 font-semibold tabular-nums">
              {showYoy && r.yoyPct != null ? (
                <span className={yoyClass(r.yoyPct)}>{signed(r.yoyPct)}</span>
              ) : (
                money(r.medianRent)
              )}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Priciest / cheapest / biggest mover — five rows a reporter can actually print. */
function Extremes({ rows, band, group }: { rows: RentRow[]; band: BedBand; group: RentGroup }) {
  const solid = rows.filter((r) => r.sampleCount >= 20);
  if (solid.length < 6) return null;

  const byRent = [...solid].sort((a, b) => b.medianRent - a.medianRent);
  // Movers demand a thicker sample than levels: "biggest faller" is the most quotable and
  // least robust cut here, so it is held to both windows clearing MOVER_MIN_SAMPLE.
  const movers = solid
    .filter((r) => r.yoyPct != null && r.sampleCount >= MOVER_MIN_SAMPLE && r.priorSample >= MOVER_MIN_SAMPLE)
    .sort((a, b) => (a.yoyPct ?? 0) - (b.yoyPct ?? 0));

  const label = BANDS.find((b) => b.key === band)!.label.toLowerCase();
  const noun = group === "House" ? "houses" : "condos";

  return (
    <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <ExtremeCard title={`Priciest ${label} ${noun}`} list={byRent.slice(0, 5)} />
      <ExtremeCard title={`Cheapest ${label} ${noun}`} list={byRent.slice(-5).reverse()} />
      {movers.length >= 5 && (
        <ExtremeCard title={`Falling fastest · ${label}`} list={movers.slice(0, 5)} showYoy />
      )}
    </div>
  );
}

const isGroup = (v: string | null): v is RentGroup => v === "House" || v === "Condo";

export function RentsBoard({ rows, summary }: { rows: RentRow[]; summary: RentRow[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  // STATE LIVES IN THE URL. Without this every view is unlinkable: the press desk promises a
  // custom cut within a day, and the natural close is "here is the live version: <link>" —
  // which is impossible if the only address is the top of the page plus instructions to
  // click House, then 3 bed, then scroll. Seeded from the query string so a shared link
  // opens on the right cut, and updated with replace() so filtering doesn't fill history.
  //
  // Houses first, deliberately: it is the half the board reports don't cover (TRREB is condo
  // apartments only). 3-bed is the most common family rental and the size people picture when
  // they ask what a house costs.
  const qpGroup = params.get("type");
  const qpBeds = params.get("beds");
  const [group, setGroup] = useState<RentGroup>(isGroup(qpGroup) ? qpGroup : "House");
  const [band, setBand] = useState<BedBand>(
    qpBeds && ["1", "2", "3", "4", "ALL"].includes(qpBeds) ? (qpBeds as BedBand) : "3"
  );
  const [query, setQuery] = useState(params.get("q") ?? "");

  const sync = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === "") next.delete(k);
        else next.set(k, v);
      }
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router]
  );
  // Thin rows are EXCLUDED from the default ranking, not merely marked. A five-lease median
  // outranking a fifty-lease one purely because it is expensive makes the whole table read
  // as unreliable — Rockcliffe (×5) and Niagara (×9) were sitting above neighbourhoods with
  // ten times the evidence. They stay one click away so small towns are never erased.
  const [showThin, setShowThin] = useState(false);

  const matching = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(
      (r) =>
        r.group === group &&
        r.beds === band &&
        // Matches city OR neighbourhood: people search "Brampton" as readily as "Churchill
        // Meadows", and a table of 494 rows with no way in is the main reason this page was
        // unusable for looking anything up.
        (!q || r.area.toLowerCase().includes(q) || r.city.toLowerCase().includes(q))
    );
  }, [rows, group, band, query]);
  const thinCount = useMemo(
    () => matching.filter((r) => r.sampleCount < THIN_SAMPLE).length,
    [matching]
  );
  const shown = useMemo(
    () => (showThin ? matching : matching.filter((r) => r.sampleCount >= THIN_SAMPLE)),
    [matching, showThin]
  );
  const activeGroup = GROUPS.find((g) => g.key === group)!;

  return (
    <div>
      <Headline summary={summary} />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {GROUPS.map((g) => {
          const on = g.key === group;
          return (
            <button
              key={g.key}
              type="button"
              onClick={() => {
                setGroup(g.key);
                sync({ type: g.key });
              }}
              aria-pressed={on}
              className={`terminal-font rounded-md border px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-colors ${
                on
                  ? "border-cyan-600/50 bg-cyan-600/15 text-cyan-700 dark:text-cyan-300"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {g.label}
            </button>
          );
        })}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {BANDS.map((b) => {
          const on = b.key === band;
          return (
            <button
              key={b.key}
              type="button"
              onClick={() => {
                setBand(b.key);
                sync({ beds: b.key });
              }}
              aria-pressed={on}
              className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                on
                  ? "border-foreground/30 bg-foreground/10 font-semibold text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {b.label}
            </button>
          );
        })}
      </div>

      <p className="mb-4 text-xs leading-relaxed text-muted-foreground sm:text-sm">
        {activeGroup.note}
        {band === "ALL" && (
          <>
            {" "}
            <strong className="text-foreground">
              &ldquo;All sizes&rdquo; mixes bedroom counts, so its year-over-year moves when a
              neighbourhood&apos;s mix changes and not only when rents do — pick a size for a
              like-for-like comparison.
            </strong>
          </>
        )}
      </p>

      <div className="mb-4">
        <label htmlFor="rent-search" className="sr-only">
          Search by city or neighbourhood
        </label>
        <input
          id="rent-search"
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            sync({ q: e.target.value });
          }}
          placeholder="Search a city or neighbourhood — Brampton, Annex, Kanata…"
          className="w-full max-w-md rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-cyan-600/50 focus:outline-none focus:ring-1 focus:ring-cyan-600/40"
        />
        {query.trim() && (
          <p className="mt-1.5 text-xs text-muted-foreground">
            {matching.length} match{matching.length === 1 ? "" : "es"} for &ldquo;{query.trim()}&rdquo;
          </p>
        )}
      </div>

      {thinCount > 0 && (
        <label className="mb-4 flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={showThin}
            onChange={(e) => setShowThin(e.target.checked)}
            className="h-3.5 w-3.5 accent-cyan-600"
          />
          Include {thinCount} neighbourhood{thinCount === 1 ? "" : "s"} with fewer than {THIN_SAMPLE}{" "}
          leases (indicative only)
        </label>
      )}

      {shown.length === 0 ? (
        <p className="rounded-lg border border-border p-6 text-sm text-muted-foreground">
          No neighbourhoods have enough closed leases at this size to report yet.
        </p>
      ) : (
        <>
          <RankingTable
            columns={columns}
            rows={shown}
            getRowKey={(r) => `${r.city}|${r.area}|${r.group}|${r.beds}`}
            gridTemplate="minmax(160px,1.7fr) 110px 110px 150px 90px"
            initialSortKey="medianRent"
            initialSortDir="desc"
            minWidth={720}
          />
          <Extremes rows={shown} band={band} group={group} />
        </>
      )}
    </div>
  );
}
