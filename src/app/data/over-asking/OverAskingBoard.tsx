"use client";

import { useCallback, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { RankingTable, type RankingColumn } from "@/components/data/RankingTable";
import {
  RANK_MIN_SAMPLE,
  THIN_SAMPLE,
  type CompetitionRow,
  type PropertyGroup,
} from "@/lib/data/competitionBoard";

const DASH = "—";
const money = (v: number) => `$${v.toLocaleString("en-CA")}`;
const pct = (v: number) => `${v.toFixed(1)}%`;
/** Percentage POINTS, not percent — the unit is in the suffix so nobody re-reads it as %. */
const signedPts = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)} pts`;

const GROUPS: { key: PropertyGroup; label: string; note: string }[] = [
  {
    key: "House",
    label: "Houses",
    note: "Detached, semi, townhouse, duplex and multiplex. Houses compete harder than condos almost everywhere — the gap between the two is usually the story.",
  },
  {
    key: "Condo",
    label: "Condos",
    note: "Condo apartments, condo townhouses and co-ops. A softer segment: fewer sales go above ask and the premiums are smaller when they do.",
  },
];

/**
 * A RISING share of homes selling over asking means a tighter market and a worse deal for
 * buyers, so it reads in the warning colour — the same consumer-facing convention the rent
 * tracker uses, where rising rents are red.
 */
function yoyClass(v: number) {
  return v > 0
    ? "text-[color:var(--dt-down)] dark:text-rose-400"
    : v < 0
      ? "text-[color:var(--dt-up)] dark:text-emerald-400"
      : "";
}

const columns: RankingColumn<CompetitionRow>[] = [
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
    key: "pctOverAsk",
    label: "Sold Over Ask",
    align: "right",
    hint: "Share of sales that closed above the seller's final asking price, last 12 months",
    sortValue: (r) => r.pctOverAsk,
    render: (r) => <span className="font-semibold tabular-nums">{pct(r.pctOverAsk)}</span>,
  },
  {
    key: "yoyOverAskPts",
    label: "vs Last Year",
    align: "right",
    hint: "Change in that share against the 12 months before, in percentage points. Blank where either period had under 100 sales.",
    sortValue: (r) => r.yoyOverAskPts,
    render: (r) =>
      r.yoyOverAskPts == null ? (
        <span className="text-muted-foreground" title="Not enough history for a reliable comparison">
          {DASH}
        </span>
      ) : (
        <span className={`font-semibold tabular-nums ${yoyClass(r.yoyOverAskPts)}`}>
          {signedPts(r.yoyOverAskPts)}
        </span>
      ),
  },
  {
    key: "medianPremium",
    label: "Typical Premium",
    align: "right",
    // The rate alone cannot tell these apart: 43% of North Bay's Ferris sells over ask at a
    // $12k premium, which is a different market from 62% of Bloor West at $170k.
    hint: "Median amount ABOVE asking, among the sales that went above. A high rate with a small premium is a different market from a high rate with a large one.",
    sortValue: (r) => r.medianPremium,
    render: (r) =>
      r.medianPremium == null ? (
        <span className="text-muted-foreground">{DASH}</span>
      ) : (
        <span className="tabular-nums text-muted-foreground">{money(r.medianPremium)}</span>
      ),
  },
  {
    key: "medianSaleToList",
    label: "Sold vs Ask",
    align: "right",
    hint: "Median sale price as a share of the final asking price. Over 100% means the typical home here sold above ask.",
    sortValue: (r) => r.medianSaleToList,
    render: (r) =>
      r.medianSaleToList == null ? (
        <span className="text-muted-foreground">{DASH}</span>
      ) : (
        <span className="tabular-nums text-muted-foreground">{r.medianSaleToList.toFixed(1)}%</span>
      ),
  },
  {
    key: "sampleCount",
    label: "Sales",
    align: "right",
    hint: "Closed sales behind the figure, last 12 months",
    // Thin rows are shown WITH their count rather than hidden — suppressing them would
    // quietly erase small towns — but marked so nobody reads one as solid.
    sortValue: (r) => r.sampleCount,
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
function Headline({ summary }: { summary: CompetitionRow[] }) {
  return (
    <div className="mb-8 overflow-x-auto rounded-xl border border-border p-4 sm:p-5">
      <p className="terminal-font text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
        Ontario-wide · share of sales closing above the final ask · vs 12 months earlier
      </p>
      <table className="mt-3 w-full min-w-[520px] border-collapse text-sm">
        <thead>
          <tr>
            <th className="pb-2 text-left font-medium text-muted-foreground" />
            <th className="pb-2 text-right font-medium text-muted-foreground">Over ask</th>
            <th className="pb-2 text-right font-medium text-muted-foreground">At ask</th>
            <th className="pb-2 text-right font-medium text-muted-foreground">Under ask</th>
            <th className="pb-2 text-right font-medium text-muted-foreground">Typical premium</th>
          </tr>
        </thead>
        <tbody>
          {GROUPS.map((g) => {
            const c = summary.find((r) => r.group === g.key);
            return (
              <tr key={g.key} className="border-t border-border">
                <td className="py-2.5 pr-3 font-semibold">{g.label}</td>
                {c ? (
                  <>
                    <td className="py-2.5 text-right">
                      <div className="font-semibold tabular-nums">{pct(c.pctOverAsk)}</div>
                      {c.yoyOverAskPts != null && (
                        <div className={`text-[11px] tabular-nums ${yoyClass(c.yoyOverAskPts)}`}>
                          {signedPts(c.yoyOverAskPts)}
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 text-right tabular-nums text-muted-foreground">
                      {c.pctAtAsk == null ? DASH : pct(c.pctAtAsk)}
                    </td>
                    <td className="py-2.5 text-right tabular-nums text-muted-foreground">
                      {c.pctUnderAsk == null ? DASH : pct(c.pctUnderAsk)}
                    </td>
                    <td className="py-2.5 text-right tabular-nums text-muted-foreground">
                      {c.medianPremium == null ? DASH : money(c.medianPremium)}
                    </td>
                  </>
                ) : (
                  <td colSpan={4} className="py-2.5 text-right text-muted-foreground">
                    {DASH}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Module scope, NOT nested inside Extremes. A component declared during render is a new type
 * on every render, so React unmounts and remounts it and any state resets — the
 * react-hooks/component-shape rule fails the build on it.
 */
function ExtremeCard({
  title,
  list,
  mode,
}: {
  title: string;
  list: CompetitionRow[];
  mode: "rate" | "yoy";
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
              {mode === "yoy" && r.yoyOverAskPts != null ? (
                <span className={yoyClass(r.yoyOverAskPts)}>{signedPts(r.yoyOverAskPts)}</span>
              ) : (
                pct(r.pctOverAsk)
              )}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Most / least competitive / cooling fastest — five rows a reporter can actually print. */
function Extremes({ rows, group }: { rows: CompetitionRow[]; group: PropertyGroup }) {
  // Ranking is held to a thicker sample than the table is. "Most competitive neighbourhood in
  // Ontario" is the most quotable and least robust cut on this page, and a 31-sale hamlet
  // topping it would become the story instead of the market.
  const solid = rows.filter((r) => r.sampleCount >= RANK_MIN_SAMPLE);
  if (solid.length < 6) return null;

  const byRate = [...solid].sort((a, b) => b.pctOverAsk - a.pctOverAsk);
  const coolers = solid
    .filter((r) => r.yoyOverAskPts != null && r.priorSample >= RANK_MIN_SAMPLE)
    .sort((a, b) => (a.yoyOverAskPts ?? 0) - (b.yoyOverAskPts ?? 0));

  const noun = group === "House" ? "houses" : "condos";

  return (
    <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <ExtremeCard title={`Most competitive · ${noun}`} list={byRate.slice(0, 5)} mode="rate" />
      <ExtremeCard
        title={`Least competitive · ${noun}`}
        list={byRate.slice(-5).reverse()}
        mode="rate"
      />
      {coolers.length >= 5 && (
        <ExtremeCard title={`Cooling fastest · ${noun}`} list={coolers.slice(0, 5)} mode="yoy" />
      )}
    </div>
  );
}

const isGroup = (v: string | null): v is PropertyGroup => v === "House" || v === "Condo";

export function OverAskingBoard({
  rows,
  summary,
}: {
  rows: CompetitionRow[];
  summary: CompetitionRow[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  // STATE LIVES IN THE URL, for the same reason it does on /data/rents: the press desk
  // promises a custom cut within a business day and the natural close is "here is the live
  // version: <link>". A view that can only be reached by clicking is not a link.
  const qpGroup = params.get("type");
  const [group, setGroup] = useState<PropertyGroup>(isGroup(qpGroup) ? qpGroup : "House");
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

  // Thin rows are EXCLUDED from the default view, not merely marked. A 31-sale neighbourhood
  // showing 45% over-ask sits above genuinely competitive markets on nothing but noise. They
  // stay one click away so small towns are never erased.
  const [showThin, setShowThin] = useState(false);

  const matching = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(
      (r) =>
        r.group === group &&
        (!q || r.area.toLowerCase().includes(q) || r.city.toLowerCase().includes(q))
    );
  }, [rows, group, query]);
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
                  ? "border-cyan-600 bg-cyan-600/10 text-cyan-700 dark:border-cyan-400 dark:text-cyan-300"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {g.label}
            </button>
          );
        })}
      </div>

      <p className="mb-4 text-xs leading-relaxed text-muted-foreground">{activeGroup.note}</p>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="sr-only" htmlFor="over-asking-search">
          Search by city or neighbourhood
        </label>
        <input
          id="over-asking-search"
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            sync({ q: e.target.value });
          }}
          placeholder="Search a city or neighbourhood…"
          className="w-full max-w-xs rounded-md border border-border bg-transparent px-3 py-1.5 text-sm outline-none focus:border-cyan-600 dark:focus:border-cyan-400"
        />
        {thinCount > 0 && (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={showThin}
              onChange={(e) => setShowThin(e.target.checked)}
              className="h-3.5 w-3.5 accent-cyan-600"
            />
            Include {thinCount} thin {thinCount === 1 ? "area" : "areas"} (under {THIN_SAMPLE} sales)
          </label>
        )}
      </div>

      {shown.length === 0 ? (
        <p className="rounded-lg border border-border p-6 text-center text-sm text-muted-foreground">
          No neighbourhoods match that search.
        </p>
      ) : (
        <>
          <RankingTable
            columns={columns}
            rows={shown}
            getRowKey={(r) => `${r.city}|${r.area}|${r.group}`}
            gridTemplate="minmax(160px,1.7fr) 120px 110px 130px 110px 90px"
            initialSortKey="pctOverAsk"
            initialSortDir="desc"
            minWidth={760}
          />
          <Extremes rows={shown} group={group} />
        </>
      )}
    </div>
  );
}
