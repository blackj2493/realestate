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
import { SIGNAL_BY_ID, SIGNAL_ORDER } from "@/lib/listings/descriptionSignals";

const LABEL = "text-[10px] font-semibold uppercase tracking-wider text-muted-foreground";

export default function DescriptionFilterSection({ className }: { className?: string }) {
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
    <section className={cn("space-y-3 border-t border-border/70 pt-4", className)} aria-label="In the description">
      <span className={LABEL}>In the description</span>

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
        <div>
          <span className={LABEL}>Ready-made · homes in view</span>
          <ul className="mt-1.5 space-y-0.5">
            {signals.map((id) => {
              const on = selected.has(id);
              const n = counts?.[id];
              return (
                <li key={id}>
                  <label className="flex min-h-[36px] cursor-pointer items-center gap-2.5 text-sm text-foreground">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggleSignal(id)}
                      className="h-4 w-4 accent-cyan-600"
                    />
                    <span className="flex-1">{SIGNAL_BY_ID[id].label}</span>
                    {n !== undefined && (
                      <span className="font-mono text-xs font-semibold text-cyan-700 dark:text-cyan-400">
                        {n.toLocaleString()}
                      </span>
                    )}
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
