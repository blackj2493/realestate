"use client";

/**
 * "In the description" — the one place description search is EDITED (desktop drawer and
 * mobile sheet both render this). Words are added from the search box or typed here;
 * ready-made signals are ticked here. Nothing about description search is permanently on
 * screen: the Showing strip lists what is active, and this section manages it.
 *
 * Counts: while this section is mounted it asks the page to facet on description_signals
 * (store.descriptionCountsWanted), so a signal shows how many homes in view carry it given
 * every other filter — including the signals already ticked, which is exactly the number a
 * reader gets if they tick it too (signals are ANDed).
 */

import React from "react";
import { ArrowLeftRight, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";
import {
  DESC_SIGNALS_KEY,
  DESC_WORDS_KEY,
  addTerm,
  descTerms,
  hasOnlyExclusions,
  removeTerm,
  signalIds,
  toggleTerm,
} from "@/lib/filters/descriptionFilters";
import { SIGNAL_BY_ID, SIGNAL_GROUP_LABEL, SIGNAL_ORDER } from "@/lib/listings/descriptionSignals";

const LABEL = "text-[10px] font-semibold uppercase tracking-wider text-muted-foreground";

export default function DescriptionFilterSection({
  className,
  bare = false,
}: {
  className?: string;
  /** Inside a titled card (the mobile sheet): drop this section's own label and rule. */
  bare?: boolean;
}) {
  const universalFilters = useCommandCenterStore((s) => s.universalFilters);
  const setUniversalFilter = useCommandCenterStore((s) => s.setUniversalFilter);
  const activePersona = useCommandCenterStore((s) => s.activePersona);
  const transactionMode = useCommandCenterStore((s) => s.transactionMode);
  const counts = useCommandCenterStore((s) => s.descriptionSignalCounts);
  const setCountsWanted = useCommandCenterStore((s) => s.setDescriptionCountsWanted);
  const [draft, setDraft] = React.useState("");

  // Counts only while this section is on screen — see the header.
  React.useEffect(() => {
    setCountsWanted(true);
    return () => setCountsWanted(false);
  }, [setCountsWanted]);

  const words = universalFilters[DESC_WORDS_KEY];
  const terms = descTerms(words);
  const selected = new Set(signalIds(universalFilters[DESC_SIGNALS_KEY]));
  const onlyExclusions = hasOnlyExclusions(universalFilters);
  const wordsOff = transactionMode !== "sale";

  const commit = () => {
    if (!draft.trim()) return;
    setUniversalFilter(DESC_WORDS_KEY, addTerm(words, draft));
    setDraft("");
  };

  const toggleSignal = (id: string) => {
    const next = selected.has(id) ? [...selected].filter((s) => s !== id) : [...selected, id];
    setUniversalFilter(DESC_SIGNALS_KEY, next);
  };

  // Persona order; a signal with no homes in view is hidden unless it is ticked (it must
  // stay reachable to untick). Before the first count arrives, show the full list.
  const signals = SIGNAL_ORDER[activePersona].filter(
    (id) => selected.has(id) || counts === null || (counts[id] ?? 0) > 0
  );

  return (
    <section
      className={cn("space-y-3", !bare && "border-t border-border/70 pt-4", className)}
      aria-label="In the description"
    >
      {!bare && <span className={LABEL}>In the description</span>}

      <div>
        <div className="flex min-h-[42px] flex-wrap items-center gap-1.5 border border-border bg-card px-2 py-1.5">
          {terms.map((t) => (
            <span
              key={t.text}
              className={cn(
                "inline-flex items-center gap-1 border px-2 py-0.5 text-xs font-semibold",
                t.exclude
                  ? "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300"
                  : "border-cyan-500/40 bg-cyan-500/10 text-cyan-800 dark:text-cyan-300"
              )}
            >
              {t.exclude ? "not " : ""}
              {t.text}
              <button
                type="button"
                onClick={() => setUniversalFilter(DESC_WORDS_KEY, toggleTerm(words, t.text))}
                aria-label={t.exclude ? `Look for “${t.text}” instead` : `Exclude “${t.text}” instead`}
                className="ml-0.5 inline-flex h-6 w-6 items-center justify-center opacity-70 hover:opacity-100"
              >
                <ArrowLeftRight className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => setUniversalFilter(DESC_WORDS_KEY, removeTerm(words, t.text))}
                aria-label={`Remove “${t.text}”`}
                className="inline-flex h-6 w-6 items-center justify-center opacity-70 hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
              }
            }}
            onBlur={commit}
            placeholder={terms.length ? "Add a word…" : "Add a word or phrase, e.g. walk-out"}
            aria-label="Add a word the description must mention. Start with a minus to exclude it."
            className="min-w-[8rem] flex-1 bg-transparent px-1 py-1 text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>
        {(wordsOff || terms.length > 0) && (
          <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
            {wordsOff
              ? "Word search covers homes for sale. Switch to For Sale to use these words."
              : onlyExclusions
                ? "Add a word to look for. “Doesn't mention” words apply alongside one."
                : "Tap ⇄ to switch between “mentions” and “doesn't mention”."}
          </p>
        )}
      </div>

      {signals.length > 0 && (
        <div className="space-y-3">
          <span className={LABEL}>Ready-made · homes in view</span>
          {(["home", "deal"] as const).map((group) => {
            const ids = signals.filter((id) => SIGNAL_BY_ID[id].group === group);
            if (!ids.length) return null;
            return (
              <div key={group}>
                <div className="mb-1.5 text-xs font-semibold text-foreground">{SIGNAL_GROUP_LABEL[group]}</div>
                <div className="flex flex-wrap gap-2" role="group" aria-label={SIGNAL_GROUP_LABEL[group]}>
                  {ids.map((id) => {
                    const on = selected.has(id);
                    const n = counts?.[id];
                    // A handful of homes is worth seeing, but it should not shout.
                    const rare = n !== undefined && n < 10;
                    return (
                      <button
                        key={id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggleSignal(id)}
                        className={cn(
                          "inline-flex min-h-[36px] items-center gap-1.5 rounded-full border px-3 text-sm transition-colors",
                          on
                            ? "border-cyan-700 bg-cyan-700 text-white dark:border-cyan-500 dark:bg-cyan-600"
                            : "border-border bg-card text-foreground hover:border-cyan-500/50"
                        )}
                      >
                        {on && <span aria-hidden>✓</span>}
                        {SIGNAL_BY_ID[id].label}
                        {n !== undefined && (
                          <span
                            className={cn(
                              "font-mono text-xs font-semibold",
                              on
                                ? "text-cyan-100"
                                : rare
                                  ? "text-muted-foreground"
                                  : "text-cyan-700 dark:text-cyan-400"
                            )}
                          >
                            {n.toLocaleString()}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
