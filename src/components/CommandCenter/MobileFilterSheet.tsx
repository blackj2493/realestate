/**
 * MobileFilterSheet — the phone (<md) filter surface. On a 360px canvas the
 * inline FilterBar chips scroll off-screen and are undiscoverable, so on mobile
 * the bar collapses to a "Filters" button that opens THIS bottom sheet, where
 * every control renders expanded at full tap-size (HouseSigma-style).
 *
 * It reuses the exact same control + chip components as the desktop bar
 * (FilterControl, InvestorChip, FundamentalToggle) so the query pipeline and
 * formatting can never drift between the two surfaces.
 *
 * FOLDING SECTIONS. The sheet used to render every control expanded in one scroll — about
 * five phone screens, with nothing to say there was more below, so the investor tools and
 * description search were effectively invisible. Each group is now a card that states in
 * one line what it holds (what is set, or what it offers), with a badge counting what is
 * set. One card is open at a time, so folded the whole sheet fits on one screen.
 */

"use client";

import React from "react";
import { X, SlidersHorizontal, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FilterDef, FilterValue } from "@/lib/filters/types";
import { moreFiltersForClass, cloneFilterValue } from "@/lib/filters/filterRegistry";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";
import { useDiscovery } from "@/lib/discovery/useDiscovery";
import { INVESTOR_CONTROLS, isFinancingControl } from "@/lib/personas/personaConfig";
import { isControlActive, investorChipLabel } from "./investorControls";
import { activeLabels, summarise, type SectionSummary } from "./filterSheetSummary";
import {
  DESC_SIGNALS_KEY,
  DESC_WORDS_KEY,
  descTerms,
  signalIds,
  termLabel,
} from "@/lib/filters/descriptionFilters";
import { SIGNAL_BY_ID } from "@/lib/listings/descriptionSignals";
import FilterChip, { FilterControl } from "./FilterChip";
import InvestorChip from "./InvestorChip";
import FinancingGroup from "./FinancingGroup";
import DescriptionFilterSection from "./DescriptionFilterSection";
import FundamentalToggle from "./FundamentalToggle";

const LABEL = "text-[10px] font-semibold uppercase tracking-wider text-muted-foreground";

const freshDefault = cloneFilterValue;

export interface FilterItem {
  def: FilterDef;
  value: FilterValue;
  onChange: (value: FilterValue) => void;
}

interface MobileFilterSheetProps {
  onClose: () => void;
  /** Scoped core filters (class-aware price + type), ready to render expanded. */
  coreItems: FilterItem[];
  /** The active persona's PINNED investor controls (shown first). */
  controls: React.ComponentProps<typeof InvestorChip>["control"][];
  /** Every OTHER investor signal — addable regardless of persona. */
  moreControls: React.ComponentProps<typeof InvestorChip>["control"][];
  /** Show the investor chips (residential-sale, active layer). */
  showInvestor: boolean;
  /** Show advanced (deep field library + investor) sections (false in comp-only Sold/De-listed). */
  showAdvanced: boolean;
  clearAll: () => void;
  anyActive: boolean;
  /** Total matching listings — surfaced on the apply button. */
  resultCount: number;
  /** Show "In the description" (flag on, residential, an active layer lit). */
  showDescription?: boolean;
}

export default function MobileFilterSheet({
  onClose,
  coreItems,
  controls,
  moreControls,
  showInvestor,
  showAdvanced,
  clearAll,
  anyActive,
  resultCount,
  showDescription = false,
}: MobileFilterSheetProps) {
  const propertyClass = useCommandCenterStore((s) => s.propertyClass);
  const setPropertyClass = useCommandCenterStore((s) => s.setPropertyClass);
  // Deep field library — read the same store slices the desktop FilterDrawer does
  // so the two surfaces share one source of truth (and the active-filter strip
  // stays in sync via addFilter/removeAddedFilter).
  const universalFilters = useCommandCenterStore((s) => s.universalFilters);
  const setUniversalFilter = useCommandCenterStore((s) => s.setUniversalFilter);
  const addFilter = useCommandCenterStore((s) => s.addFilter);
  const removeAddedFilter = useCommandCenterStore((s) => s.removeAddedFilter);

  // While this sheet is open, hide the global Guide launcher (FAB) so it can't
  // float over the "Show N results" CTA below. Mounts only when open, so a plain
  // mount/unmount ref-count is enough. See useDiscovery.chromeBlockers.
  React.useEffect(() => {
    const { blockChrome, unblockChrome } = useDiscovery.getState();
    blockChrome();
    return unblockChrome;
  }, []);

  // Lock body scroll while open; close on Escape.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  // The financing trio renders in its own explained box, never as loose chips. It can sit
  // in EITHER incoming list depending on the persona, so both are stripped here.
  const personaSignals = controls.filter((c) => !isFinancingControl(c));
  const moreSignals = moreControls.filter((c) => !isFinancingControl(c));
  const financingControls = [...controls, ...moreControls].filter(isFinancingControl);

  const filters = useCommandCenterStore((s) => s.filters);
  // Price opens by default: it is the one filter nearly every reader sets first.
  const [open, setOpen] = React.useState<string | null>("price");

  const byKey = (key: string) => coreItems.find((i) => i.def.key === key);
  const price = byKey("price");
  const rooms = [byKey("beds"), byKey("baths")].filter((i): i is FilterItem => !!i);
  const homeType = byKey("homeType");
  // Anything the class scopes in that this layout has no named card for still renders.
  const otherCore = coreItems.filter((i) => !["price", "beds", "baths", "homeType"].includes(i.def.key));
  const detailDefs = showAdvanced ? moreFiltersForClass(propertyClass) : [];
  const detailItems = detailDefs.map((def) => ({ def, value: universalFilters[def.key] ?? def.defaultValue }));

  const descSummary = (): SectionSummary => {
    const labels = [
      ...signalIds(universalFilters[DESC_SIGNALS_KEY]).map(
        (id) => SIGNAL_BY_ID[id as keyof typeof SIGNAL_BY_ID].label
      ),
      ...descTerms(universalFilters[DESC_WORDS_KEY]).map(termLabel),
    ];
    return summarise(labels, "Words, separate entrance, power of sale…");
  };
  const investorSummary = (): SectionSummary =>
    summarise(
      INVESTOR_CONTROLS.filter((c) => isControlActive(c, filters)).map((c) => investorChipLabel(c, filters)),
      "Cap rate, cashflow, True DOM, price drop…"
    );

  const classLabel = propertyClass === "commercial" ? "Commercial" : "Residential";
  const typeLabels = homeType ? activeLabels([homeType]) : [];

  const sections: Array<{ id: string; title: string; summary: SectionSummary; body: React.ReactNode }> = [];
  if (price)
    sections.push({
      id: "price",
      title: "Price",
      summary: summarise(activeLabels([price]), "Any price"),
      body: <FilterControl def={price.def} value={price.value} onChange={price.onChange} />,
    });
  if (rooms.length)
    sections.push({
      id: "rooms",
      title: rooms.length === 2 ? "Beds & baths" : rooms[0].def.label,
      summary: summarise(activeLabels(rooms), "Any"),
      body: (
        <div className="space-y-5">
          {rooms.map(({ def, value, onChange }) => (
            <FilterControl key={def.key} def={def} value={value} onChange={onChange} />
          ))}
        </div>
      ),
    });
  sections.push({
    id: "type",
    title: "Home type",
    summary: {
      text: [classLabel, ...(typeLabels.length ? typeLabels : ["any type"])].join(" · "),
      active: typeLabels.length > 0 || propertyClass === "commercial",
      count: typeLabels.length,
    },
    body: (
      <div className="space-y-4">
        <FundamentalToggle
          ariaLabel="Property class"
          value={propertyClass}
          onChange={setPropertyClass}
          options={[
            { value: "residential", label: "Residential" },
            { value: "commercial", label: "Commercial" },
          ]}
        />
        {homeType && (
          <FilterControl def={homeType.def} value={homeType.value} onChange={homeType.onChange} enumLayout="chips" />
        )}
        {otherCore.map(({ def, value, onChange }) => (
          <FilterControl key={def.key} def={def} value={value} onChange={onChange} />
        ))}
      </div>
    ),
  });
  if (detailDefs.length)
    sections.push({
      id: "details",
      title: "Home details",
      summary: summarise(activeLabels(detailItems), "Size, basement, lot, parking, age, fees…"),
      // Tap-to-open chips: their popovers portal above the sheet, exactly as before.
      body: (
        <div className="flex flex-wrap gap-2">
          {detailDefs.map((def) => (
            <FilterChip
              key={def.key}
              def={def}
              value={universalFilters[def.key] ?? def.defaultValue}
              onChange={(v) => {
                setUniversalFilter(def.key, v);
                // Track the key so the active-filter strip sees it (mirrors drawer).
                if (def.isActive(v)) addFilter(def.key);
                else removeAddedFilter(def.key);
              }}
              onClear={() => {
                setUniversalFilter(def.key, freshDefault(def.defaultValue));
                removeAddedFilter(def.key);
              }}
            />
          ))}
        </div>
      ),
    });
  if (showDescription)
    sections.push({
      id: "description",
      title: "In the description",
      summary: descSummary(),
      body: <DescriptionFilterSection bare />,
    });
  if (showAdvanced && showInvestor)
    sections.push({
      id: "investor",
      title: "Investor signals",
      summary: investorSummary(),
      body: (
        <div className="space-y-4">
          <FinancingGroup controls={financingControls} bare />
          {personaSignals.length > 0 && (
            <div className="space-y-2">
              <span className={LABEL}>For your lens</span>
              <div className="flex flex-wrap gap-2">
                {personaSignals.map((c, i) => (
                  <InvestorChip key={i} control={c} />
                ))}
              </div>
            </div>
          )}
          {moreSignals.length > 0 && (
            <div className="space-y-2">
              <span className={LABEL}>More signals</span>
              <div className="flex flex-wrap gap-2">
                {moreSignals.map((c, i) => (
                  <InvestorChip key={i} control={c} />
                ))}
              </div>
            </div>
          )}
        </div>
      ),
    });

  return (
    <div
      className="fixed inset-0 z-[70] flex flex-col justify-end md:hidden"
      role="dialog"
      aria-modal="true"
      aria-label="Filters"
    >
      {/* Backdrop — tap to dismiss. */}
      <button type="button" aria-label="Close filters" onClick={onClose} className="absolute inset-0 bg-background/80" />

      <div className="relative flex max-h-[88dvh] flex-col border-t border-border bg-background pb-safe">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3 pt-safe">
          <h2 className="flex items-center gap-2 font-mono text-sm font-semibold uppercase tracking-wider text-foreground">
            <SlidersHorizontal className="h-4 w-4 text-cyan-700 dark:text-cyan-400" />
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
        </div>

        {/* Body — folding section cards; one open at a time. */}
        <div className="flex-1 space-y-2.5 overflow-y-auto overscroll-contain px-4 py-4">
          {sections.map((sec) => (
            <SheetSection
              key={sec.id}
              title={sec.title}
              summary={sec.summary}
              open={open === sec.id}
              onToggle={() => setOpen((cur) => (cur === sec.id ? null : sec.id))}
            >
              {sec.body}
            </SheetSection>
          ))}
        </div>

        {/* Footer — Clear + apply (count). Both are real 44px targets. */}
        <div className="flex shrink-0 items-center gap-3 border-t border-border px-4 py-3">
          {anyActive && (
            <button
              type="button"
              onClick={clearAll}
              className={cn(
                "min-h-[44px] flex-1 border border-border px-4 font-mono text-xs font-semibold uppercase tracking-wider text-foreground",
                "transition-colors hover:border-cyan-500/50 hover:text-cyan-600 dark:hover:text-cyan-300 active:bg-muted"
              )}
            >
              Clear all
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] flex-[2] bg-cyan-500 px-4 font-mono text-sm font-semibold text-slate-950 transition-colors hover:bg-cyan-400 active:bg-cyan-600"
          >
            Show {resultCount.toLocaleString()} {resultCount === 1 ? "result" : "results"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * One folding card: a header that says what the section holds (accent when something is
 * set, plus a count badge), and its controls when open.
 */
function SheetSection({
  title,
  summary,
  open,
  onToggle,
  children,
}: {
  title: string;
  summary: SectionSummary;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const id = React.useId();
  return (
    <section className="rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={id}
        className="flex min-h-[56px] w-full items-center gap-3 px-4 py-3 text-left"
      >
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-semibold text-foreground">{title}</span>
          <span
            className={cn(
              "truncate text-xs",
              summary.active ? "font-semibold text-cyan-700 dark:text-cyan-400" : "text-muted-foreground"
            )}
          >
            {summary.text}
          </span>
        </span>
        {summary.count > 0 && (
          <span className="shrink-0 rounded-full bg-cyan-600 px-2 py-0.5 font-mono text-[10px] font-semibold text-white">
            {summary.count}
          </span>
        )}
        <ChevronDown
          className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
        />
      </button>
      {open && (
        <div id={id} className="border-t border-border/70 px-4 pb-4 pt-4">
          {children}
        </div>
      )}
    </section>
  );
}
