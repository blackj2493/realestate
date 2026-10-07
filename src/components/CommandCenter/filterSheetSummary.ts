/**
 * One-line summaries for the folding sections of the mobile Filters sheet — pure.
 *
 * The sheet used to be one long scroll (~5 phone screens) with nothing to say there was more
 * below. Folded, every section is a card that states what it holds in one line, so the whole
 * sheet fits on one screen and a reader sees what is set without opening anything.
 */

import type { FilterDef, FilterValue } from "@/lib/filters/types";

export interface SummaryItem {
  def: FilterDef;
  value: FilterValue;
}

/** Labels of the active items, in order. Defensive: a malformed stored value is skipped. */
export function activeLabels(items: SummaryItem[]): string[] {
  const out: string[] = [];
  for (const { def, value } of items) {
    try {
      if (def.isActive(value)) out.push(def.chipLabel(value));
    } catch {
      /* skip a value the def cannot read — the query builder skips it too */
    }
  }
  return out;
}

export interface SectionSummary {
  /** The line under the section title. */
  text: string;
  /** True when it describes filters that are set (rendered in the accent colour). */
  active: boolean;
  /** How many filters in the section are set — the badge. */
  count: number;
}

/**
 * `labels` are what is set; `idle` is what the section offers when nothing is. Long lists are
 * cut to the first two plus "+N" so the line never wraps.
 */
export function summarise(labels: string[], idle: string): SectionSummary {
  if (!labels.length) return { text: idle, active: false, count: 0 };
  const shown = labels.slice(0, 2).join(" · ");
  const more = labels.length > 2 ? ` · +${labels.length - 2}` : "";
  return { text: `${shown}${more}`, active: true, count: labels.length };
}
