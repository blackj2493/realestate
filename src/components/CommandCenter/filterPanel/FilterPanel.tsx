"use client";

/**
 * FilterPanel — the one Filters surface, drawn as a full-height bottom sheet on phones
 * (MobileFilterSheet) and a right-side drawer on desktop (FilterDrawer).
 *
 * LAYOUT. The filters nearly every search starts with (price, beds & baths, home type) are
 * open on the first page and need no tap. The lens decides what sits beside them: its
 * investor tools open straight under price (the Cashflow lens opens its financing card) and
 * a row of one-tap picks with live counts. Everything deeper is three rows, each opening its
 * own page with a back arrow: Home details, In the description, Investor signals.
 *
 * It replaced folding cards: a closed card hides its controls, people do not open what they
 * cannot see, and price sat behind a tap for every reader.
 *
 * NO DEAD ENDS. Picks show their count before they are tapped and grey out at zero; the
 * "Show N homes" button counts live; and if a change empties the map, the footer offers to
 * undo that change rather than leaving the reader to guess which filter did it.
 */

import React from "react";
import {
  ChevronLeft,
  LineChart,
  MessageSquareText,
  Ruler,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { FilterDef, FilterValue } from "@/lib/filters/types";
import { cloneFilterValue, moreFiltersForClass } from "@/lib/filters/filterRegistry";
import {
  DESC_SIGNALS_KEY,
  DESC_WORDS_FILTER,
  DESC_WORDS_KEY,
  descTerms,
  signalIds,
  termLabel,
} from "@/lib/filters/descriptionFilters";
import { SIGNAL_BY_ID } from "@/lib/listings/descriptionSignals";
import {
  CASHFLOW_BLOCK,
  CONTROL_BY_ID,
  INVESTOR_GROUPS,
  LENS_PANEL,
  isPickActive,
  pickClause,
  togglePick,
  type PickDef,
} from "@/lib/filters/filterPanelConfig";
import {
  INVESTOR_CONTROLS,
  PERSONA_CONFIG,
  defaultTerminalFilters,
  type ControlDef,
  type TerminalFilterState,
} from "@/lib/personas/personaConfig";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";
import { useDiscovery } from "@/lib/discovery/useDiscovery";
import { FilterControl } from "../FilterChip";
import { InvestorControlBody } from "../InvestorChip";
import DescriptionFilterSection from "../DescriptionFilterSection";
import { investorChipLabel, isControlActive } from "../investorControls";
import { activeLabels, summarise } from "../filterSheetSummary";
import type { FilterItem, FilterToken } from "../filterTokens";
import { FieldHeader, GroupLabel, LABEL, NavRow, PanelCard, SwitchRow, sentenceCase } from "./primitives";
import PanelErrorBoundary from "./PanelErrorBoundary";
import FundamentalToggle from "../FundamentalToggle";
import HomeTypeTiles from "./HomeTypeTiles";
import LensPicks from "./LensPicks";
import CashflowCard from "./CashflowCard";

type Page = "main" | "details" | "description" | "investor";

const PAGE_TITLE: Record<Exclude<Page, "main">, string> = {
  details: "Home details",
  description: "In the description",
  investor: "Investor signals",
};

/** The financing switch, counted like a pick so the cashflow card can say how many clear it. */
const CASHFLOW_PICK: PickDef = { kind: "toggle", key: "cashflowPositiveOnly", label: "Cashflow positive only" };

/** Toggle names as a sentence, not a chip. */
const TOGGLE_LABEL: Record<string, string> = {
  staleOnly: "Stale listings only",
  duplexCandidate: "Suite or duplex potential",
  zoningPotential: "Zoning / density ready",
  cashflowPositiveOnly: "Cashflow positive only",
};
const TOGGLE_HINT: Record<string, string> = {
  duplexCandidate: "Has a suite, could add one, or suits a multi-unit conversion",
};

export interface FilterPanelProps {
  surface: "sheet" | "drawer";
  onClose: () => void;
  /** Scoped core filters (class-aware price + type), ready to render. */
  coreItems: FilterItem[];
  /** Every active filter, each removable (the same list as the strip under the bar). */
  tokens: FilterToken[];
  /** Investor layer is live (residential, for sale, an active layer lit). */
  showInvestor: boolean;
  /** False in comp-only (Sold / De-listed) browsing: only the basics apply there. */
  showAdvanced: boolean;
  /** "In the description" applies (flag on, residential, an active layer lit). */
  showDescription: boolean;
  clearAll: () => void;
  anyActive: boolean;
  /** Matching listings — the number on the apply button. */
  resultCount: number;
  /** Sheet only: handlers for the grab handle (swipe down to close). */
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>;
}

export default function FilterPanel({
  surface,
  onClose,
  coreItems,
  tokens,
  showInvestor,
  showAdvanced,
  showDescription,
  clearAll,
  anyActive,
  resultCount,
  dragHandleProps,
}: FilterPanelProps) {
  const propertyClass = useCommandCenterStore((s) => s.propertyClass);
  const setPropertyClass = useCommandCenterStore((s) => s.setPropertyClass);
  const universalFilters = useCommandCenterStore((s) => s.universalFilters);
  const setUniversalFilter = useCommandCenterStore((s) => s.setUniversalFilter);
  const addFilter = useCommandCenterStore((s) => s.addFilter);
  const removeAddedFilter = useCommandCenterStore((s) => s.removeAddedFilter);
  const filters = useCommandCenterStore((s) => s.filters);
  const setFilters = useCommandCenterStore((s) => s.setFilters);
  const activePersona = useCommandCenterStore((s) => s.activePersona);
  const transactionMode = useCommandCenterStore((s) => s.transactionMode);
  const isLoading = useCommandCenterStore((s) => s.isLoading);
  const pickCounts = useCommandCenterStore((s) => s.pickCounts);
  const setPickCountClauses = useCommandCenterStore((s) => s.setPickCountClauses);

  const [page, setPage] = React.useState<Page>("main");
  const [query, setQuery] = React.useState("");
  const bodyRef = React.useRef<HTMLDivElement>(null);
  // Block body on purpose: an effect's return value is its cleanup, and current Chrome makes
  // scrollTo() return a Promise. Returned from an arrow, React later called that Promise as
  // the cleanup on the next page change ("i is not a function") and took the terminal down.
  React.useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [page]);

  usePanelChrome(onClose, page, () => setPage("main"));
  const undo = useUndoLastChange();

  // ── What applies ────────────────────────────────────────────────────────────
  const investorOn = showAdvanced && showInvestor;
  const persona = PERSONA_CONFIG[activePersona];
  const PersonaIcon = persona.icon;
  const lens = LENS_PANEL[activePersona];
  const blockIds = investorOn ? lens.block : [];
  const signals = signalIds(universalFilters[DESC_SIGNALS_KEY]);
  const picks = showAdvanced
    ? lens.picks.filter((p) => (p.kind === "signal" ? showDescription : investorOn))
    : [];
  const cashflowCardShown = investorOn && (blockIds.includes(CASHFLOW_BLOCK) || page === "investor");

  // ── Live counts for the picks (and the cashflow switch) ───────────────────────
  const cashflowClause = cashflowCardShown ? pickClause(CASHFLOW_PICK, filters) : null;
  const clauses = [...picks.map((p) => pickClause(p, filters)), cashflowClause].filter(
    (c): c is string => Boolean(c)
  );
  const clauseKey = clauses.join("\n");
  React.useEffect(() => {
    setPickCountClauses(clauseKey ? clauseKey.split("\n") : null);
  }, [clauseKey, setPickCountClauses]);
  React.useEffect(() => () => setPickCountClauses(null), [setPickCountClauses]);
  const countOf = (clause: string | null) => (clause ? pickCounts?.[clause] : undefined);

  const onTogglePick = (p: PickDef) => {
    const change = togglePick(p, { filters, signals }, defaultTerminalFilters);
    if (change.filters) setFilters({ ...filters, ...change.filters });
    if (change.signals) setUniversalFilter(DESC_SIGNALS_KEY, change.signals);
  };

  // ── Core items ──────────────────────────────────────────────────────────────
  const byKey = (key: string) => coreItems.find((i) => i.def.key === key);
  const price = byKey("price");
  const rooms = [byKey("beds"), byKey("baths")].filter((i): i is FilterItem => !!i);
  const homeType = byKey("homeType");
  const otherCore = coreItems.filter((i) => !["price", "beds", "baths", "homeType"].includes(i.def.key));

  // ── Deeper pages ────────────────────────────────────────────────────────────
  const detailDefs = showAdvanced ? moreFiltersForClass(propertyClass) : [];
  const detailItems = detailDefs.map((def) => ({ def, value: universalFilters[def.key] ?? def.defaultValue }));
  const setDetail = (def: FilterDef, v: FilterValue) => {
    setUniversalFilter(def.key, v);
    // Track the key so the active-filter strip sees it (it lists added filters).
    if (def.isActive(v)) addFilter(def.key);
    else removeAddedFilter(def.key);
  };

  const detailLabels = activeLabels(detailItems);
  const descLabels = [
    ...signals.map((id) => SIGNAL_BY_ID[id as keyof typeof SIGNAL_BY_ID].label),
    ...descTerms(universalFilters[DESC_WORDS_KEY]).map(termLabel),
  ];
  const investorLabels = INVESTOR_CONTROLS.filter((c) => isControlActive(c, filters)).map((c) =>
    investorChipLabel(c, filters)
  );
  const detailSummary = summarise(detailLabels, "Size, basement, lot, parking, age, fees");
  const descSummary = summarise(descLabels, "Words, separate entrance, power of sale");
  const investorSummary = summarise(investorLabels, "Cashflow, cap rate, True DOM, price drops");

  const clearPage = () => {
    if (page === "details")
      for (const def of detailDefs) {
        setUniversalFilter(def.key, cloneFilterValue(def.defaultValue));
        removeAddedFilter(def.key);
      }
    if (page === "description") {
      setUniversalFilter(DESC_SIGNALS_KEY, []);
      setUniversalFilter(DESC_WORDS_KEY, cloneFilterValue(DESC_WORDS_FILTER.defaultValue));
    }
    if (page === "investor") setFilters({ ...filters, ...investorDefaults() });
  };
  const pageActive =
    page === "details"
      ? detailLabels.length > 0
      : page === "description"
        ? descLabels.length > 0
        : page === "investor"
          ? investorLabels.length > 0
          : anyActive;

  // ── Desktop "find a filter" ─────────────────────────────────────────────────
  const needle = surface === "drawer" && page === "main" ? query.trim().toLowerCase() : "";

  const noun = transactionMode === "rent" ? (resultCount === 1 ? "rental" : "rentals") : resultCount === 1 ? "home" : "homes";
  const empty = resultCount === 0 && anyActive && !isLoading;

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {/* ── Header ── */}
      <div className="shrink-0">
        {surface === "sheet" && (
          <div {...dragHandleProps} className="flex cursor-grab touch-none justify-center pb-1 pt-2">
            <span className="h-1 w-10 bg-border" aria-hidden />
          </div>
        )}
        <div className="flex min-h-[52px] items-center gap-2 border-b border-border px-4">
          {page === "main" ? (
            <>
              <h2 className="flex flex-1 items-center gap-2 font-mono text-sm font-semibold uppercase tracking-wider text-foreground">
                <SlidersHorizontal className="h-4 w-4 text-cyan-700 dark:text-cyan-400" aria-hidden />
                Filters
              </h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close filters"
                className="-mr-2 flex h-11 w-11 items-center justify-center text-muted-foreground hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setPage("main")}
                className={cn(LABEL, "-ml-2 flex min-h-[44px] items-center gap-0.5 pl-1 pr-2 text-cyan-700 hover:text-cyan-600 dark:text-cyan-400")}
              >
                <ChevronLeft className="h-4 w-4" aria-hidden />
                Filters
              </button>
              <h2 className="flex-1 truncate text-center font-mono text-sm font-semibold uppercase tracking-wider text-foreground">
                {PAGE_TITLE[page]}
              </h2>
              <button
                type="button"
                onClick={clearPage}
                disabled={!pageActive}
                className={cn(
                  LABEL,
                  "min-h-[32px] border border-border px-2.5 text-muted-foreground transition-colors hover:border-rose-500/40 hover:text-rose-500 disabled:opacity-40 disabled:hover:border-border disabled:hover:text-muted-foreground"
                )}
              >
                Clear
              </button>
            </>
          )}
        </div>

        {surface === "drawer" && page === "main" && (
          <div className="px-4 pt-3">
            <label className="flex items-center gap-2 border border-border bg-card px-2.5 focus-within:border-cyan-500/50">
              <Search className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Find a filter…"
                aria-label="Find a filter"
                className="w-full bg-transparent py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
              />
            </label>
          </div>
        )}

        {page === "main" && !needle && tokens.length > 0 && (
          <div className="no-scrollbar flex gap-1.5 overflow-x-auto px-4 pt-3" aria-label="Filters you have set">
            {tokens.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={t.onRemove}
                aria-label={`Remove ${t.label}`}
                className={cn(
                  "inline-flex min-h-[32px] shrink-0 items-center gap-1 border px-2 font-mono text-[11px] font-semibold transition-colors",
                  t.tone === "investor"
                    ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                    : "border-cyan-500/50 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300"
                )}
              >
                {t.label}
                <X className="h-3 w-3 opacity-70" aria-hidden />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Body ── */}
      <div ref={bodyRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 pb-6 pt-3">
        <PanelErrorBoundary key={`${page}:${needle}`} onBack={() => setPage("main")} onReset={clearAll}>
        {needle ? (
          <SearchResults
            needle={needle}
            detailItems={detailItems}
            onDetail={setDetail}
            investorOn={investorOn}
            showDescription={showDescription}
          />
        ) : page === "main" ? (
          <>
            {price && (
              <PanelCard>
                <div className="flex items-center justify-between">
                  <span className={cn(LABEL, "text-muted-foreground")}>Price</span>
                  {transactionMode === "rent" && <span className={cn(LABEL, "text-muted-foreground")}>per month</span>}
                </div>
                <div
                  className={cn(
                    "font-mono text-xl font-semibold tabular-nums",
                    price.def.isActive(price.value) ? "text-cyan-700 dark:text-cyan-400" : "text-muted-foreground"
                  )}
                >
                  {price.def.isActive(price.value) ? price.def.chipLabel(price.value) : "Any price"}
                </div>
                <FilterControl def={price.def} value={price.value} onChange={price.onChange} variant="panel" hideHeader />
              </PanelCard>
            )}

            {blockIds.includes(CASHFLOW_BLOCK) && <CashflowCard count={countOf(cashflowClause)} />}
            {blockIds.some((id) => id !== CASHFLOW_BLOCK) && (
              <section className="space-y-2">
                <GroupLabel icon={<PersonaIcon className="h-3.5 w-3.5" aria-hidden />}>{persona.short} tools</GroupLabel>
                <PanelCard className="space-y-0 divide-y divide-border/60 py-1 [&>*]:py-4">
                  {blockIds
                    .filter((id) => id !== CASHFLOW_BLOCK)
                    .map((id) => (
                      <InvestorField key={id} control={CONTROL_BY_ID[id]} histogram />
                    ))}
                </PanelCard>
              </section>
            )}

            {rooms.length > 0 && (
              <PanelCard className="space-y-5">
                {rooms.map(({ def, value, onChange }) => (
                  <FilterControl key={def.key} def={def} value={value} onChange={onChange} variant="panel" />
                ))}
              </PanelCard>
            )}

            <PanelCard>
              <div className="flex items-center justify-between gap-3">
                <span className={cn(LABEL, "text-muted-foreground")}>Home type</span>
                <FundamentalToggle
                  ariaLabel="Property class"
                  value={propertyClass}
                  onChange={setPropertyClass}
                  options={[
                    { value: "residential", label: "Residential" },
                    { value: "commercial", label: "Commercial" },
                  ]}
                />
              </div>
              {homeType && <HomeTypeTiles def={homeType.def} value={homeType.value} onChange={homeType.onChange} />}
              {otherCore.map(({ def, value, onChange }) => (
                <FilterControl key={def.key} def={def} value={value} onChange={onChange} variant="panel" enumLayout="chips" />
              ))}
            </PanelCard>

            <LensPicks
              title={`${persona.short} picks`}
              titleIcon={<PersonaIcon className="h-3.5 w-3.5" aria-hidden />}
              picks={picks.map((p) => ({
                pick: p,
                active: isPickActive(p, { filters, signals }),
                count: countOf(pickClause(p, filters)),
              }))}
              onToggle={onTogglePick}
            />

            {showAdvanced && (detailDefs.length > 0 || showDescription || investorOn) && (
              <div className="divide-y divide-border border border-border bg-card">
                {detailDefs.length > 0 && (
                  <NavRow
                    icon={<Ruler className="h-[18px] w-[18px]" aria-hidden />}
                    title="Home details"
                    {...rowState(detailSummary)}
                    onClick={() => setPage("details")}
                  />
                )}
                {showDescription && (
                  <NavRow
                    icon={<MessageSquareText className="h-[18px] w-[18px]" aria-hidden />}
                    title="In the description"
                    {...rowState(descSummary)}
                    onClick={() => setPage("description")}
                  />
                )}
                {investorOn && (
                  <NavRow
                    icon={<LineChart className="h-[18px] w-[18px]" aria-hidden />}
                    title="Investor signals"
                    {...rowState(investorSummary)}
                    onClick={() => setPage("investor")}
                  />
                )}
              </div>
            )}
          </>
        ) : page === "details" ? (
          detailItems.map(({ def, value }) => (
            <PanelCard key={def.key}>
              <DetailField def={def} value={value} onChange={(v) => setDetail(def, v)} />
            </PanelCard>
          ))
        ) : page === "description" ? (
          <PanelCard>
            <DescriptionFilterSection bare />
          </PanelCard>
        ) : (
          INVESTOR_GROUPS.map((g) =>
            g.id === "cashflow" ? (
              <section key={g.id} className="space-y-2">
                <GroupLabel>{g.label}</GroupLabel>
                <CashflowCard count={countOf(cashflowClause)} />
              </section>
            ) : (
              <section key={g.id} className="space-y-2">
                <GroupLabel>{g.label}</GroupLabel>
                <PanelCard className="space-y-0 divide-y divide-border/60 py-1 [&>*]:py-4">
                  {g.ids.map((id) => (
                    <InvestorField key={id} control={CONTROL_BY_ID[id]} histogram={false} />
                  ))}
                </PanelCard>
              </section>
            )
          )
        )}
        </PanelErrorBoundary>
      </div>

      {/* ── Footer: within thumb reach ── */}
      <div className="shrink-0 space-y-2 border-t border-border bg-card px-4 pb-safe pt-3">
        {empty && (
          <div
            role="status"
            className="flex items-center justify-between gap-3 border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200"
          >
            <span>No {transactionMode === "rent" ? "rentals" : "homes"} match these filters.</span>
            <button
              type="button"
              onClick={undo.canUndo ? undo.undo : clearAll}
              className={cn(LABEL, "shrink-0 underline underline-offset-2")}
            >
              {undo.canUndo ? "Undo last change" : "Clear all"}
            </button>
          </div>
        )}
        <div className="flex items-center gap-2 pb-3">
          <button
            type="button"
            onClick={clearAll}
            disabled={!anyActive}
            className={cn(
              "min-h-[44px] flex-1 border border-border px-4 font-mono text-xs font-semibold uppercase tracking-wider text-foreground",
              "transition-colors hover:border-cyan-500/50 hover:text-cyan-600 active:bg-muted disabled:opacity-40 dark:hover:text-cyan-300"
            )}
          >
            Clear all
          </button>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] flex-[2] bg-cyan-500 px-4 font-mono text-sm font-semibold text-slate-950 transition-colors hover:bg-cyan-400 active:bg-cyan-600"
          >
            Show{" "}
            <span className={cn(isLoading && "animate-pulse opacity-70")}>
              {resultCount.toLocaleString("en-US")}
            </span>{" "}
            {noun}
          </button>
        </div>
      </div>
    </div>
  );
}

/** NavRow props from a section summary. */
function rowState(s: { text: string; active: boolean; count: number }) {
  return { summary: s.text, active: s.active, count: s.count };
}

/** Defaults for every investor control's state key(s), for the page's Clear. */
function investorDefaults(): Partial<TerminalFilterState> {
  const out: Partial<TerminalFilterState> = {};
  const put = <K extends keyof TerminalFilterState>(k: K) => {
    out[k] = defaultTerminalFilters[k];
  };
  for (const c of INVESTOR_CONTROLS) {
    if (c.kind === "range") {
      put(c.minKey);
      put(c.maxKey);
    } else put(c.key);
  }
  return out;
}

/** One investor control drawn inline: a switch row, or the panel slider. */
function InvestorField({ control, histogram }: { control: ControlDef | undefined; histogram: boolean }) {
  const filters = useCommandCenterStore((s) => s.filters);
  const setFilter = useCommandCenterStore((s) => s.setFilter);
  if (!control) return null;
  if (control.kind === "toggle")
    return (
      <SwitchRow
        label={TOGGLE_LABEL[control.key] ?? control.label}
        hint={TOGGLE_HINT[control.key]}
        checked={filters[control.key]}
        onChange={(v) => setFilter(control.key, v)}
      />
    );
  return <InvestorControlBody control={control} variant="panel" histogram={histogram} />;
}

/** A "Home details" field: enums get a header over their pills; the rest draw their own. */
function DetailField({
  def,
  value,
  onChange,
}: {
  def: FilterDef;
  value: FilterValue;
  onChange: (v: FilterValue) => void;
}) {
  if (def.control === "enum") {
    const active = def.isActive(value);
    return (
      <div className="space-y-3">
        <FieldHeader
          label={sentenceCase(def.label)}
          value={active ? `${(value as string[]).length} selected` : "Any"}
          active={active}
        />
        <FilterControl def={def} value={value} onChange={onChange} variant="panel" enumLayout="chips" />
      </div>
    );
  }
  return <FilterControl def={def} value={value} onChange={onChange} variant="panel" />;
}

/** Desktop "find a filter": every matching field from every page, editable in place. */
function SearchResults({
  needle,
  detailItems,
  onDetail,
  investorOn,
  showDescription,
}: {
  needle: string;
  detailItems: Array<{ def: FilterDef; value: FilterValue }>;
  onDetail: (def: FilterDef, v: FilterValue) => void;
  investorOn: boolean;
  showDescription: boolean;
}) {
  const details = detailItems.filter(({ def }) => def.label.toLowerCase().includes(needle));
  const investor = investorOn
    ? INVESTOR_CONTROLS.filter((c) =>
        [c.label, c.short ?? "", c.kind === "toggle" ? TOGGLE_LABEL[c.key] ?? "" : ""].some((t) =>
          t.toLowerCase().includes(needle)
        )
      )
    : [];
  const description = showDescription && "in the description words mentions signals remarks".includes(needle);

  if (!details.length && !investor.length && !description)
    return <p className="px-1 py-10 text-center text-sm text-muted-foreground">No filters match “{needle}”.</p>;

  return (
    <>
      {details.map(({ def, value }) => (
        <PanelCard key={def.key}>
          <DetailField def={def} value={value} onChange={(v) => onDetail(def, v)} />
        </PanelCard>
      ))}
      {investor.length > 0 && (
        <PanelCard className="space-y-0 divide-y divide-border/60 py-1 [&>*]:py-4">
          {investor.map((c) => (
            <InvestorField key={c.kind === "range" ? c.minKey : c.key} control={c} histogram={false} />
          ))}
        </PanelCard>
      )}
      {description && (
        <PanelCard>
          <DescriptionFilterSection bare />
        </PanelCard>
      )}
    </>
  );
}

/**
 * While the panel is open: hide the Guide launcher (it would float over the apply button),
 * lock the page behind it, and let Escape step back a page before it closes the panel.
 */
function usePanelChrome(onClose: () => void, page: Page, back: () => void) {
  React.useEffect(() => {
    const { blockChrome, unblockChrome } = useDiscovery.getState();
    blockChrome();
    return unblockChrome;
  }, []);

  // Refs, so a parent re-render (new inline callbacks) does not re-run the effect.
  const latest = React.useRef({ page, onClose, back });
  latest.current = { page, onClose, back };
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (latest.current.page !== "main") latest.current.back();
      else latest.current.onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, []);
}

/**
 * Remembers the filters as they were before each change made while the panel is open, so
 * an empty result can be walked back one step. A slider drag is one change: edits less than
 * 800ms apart extend the same step instead of stacking dozens of tiny ones.
 */
function useUndoLastChange() {
  const stack = React.useRef<Array<Pick<ReturnType<typeof useCommandCenterStore.getState>, "filters" | "universalFilters">>>([]);
  const restoring = React.useRef(false);
  const [canUndo, setCanUndo] = React.useState(false);

  React.useEffect(() => {
    let last = 0;
    return useCommandCenterStore.subscribe((state, prev) => {
      if (restoring.current) return;
      if (state.filters === prev.filters && state.universalFilters === prev.universalFilters) return;
      const now = Date.now();
      if (now - last > 800) {
        stack.current.push({ filters: prev.filters, universalFilters: prev.universalFilters });
        setCanUndo(true);
      }
      last = now;
    });
  }, []);

  const undo = React.useCallback(() => {
    const snap = stack.current.pop();
    if (!snap) return;
    restoring.current = true;
    useCommandCenterStore.setState({ filters: snap.filters, universalFilters: snap.universalFilters });
    restoring.current = false;
    setCanUndo(stack.current.length > 0);
  }, []);

  return { canUndo, undo };
}
