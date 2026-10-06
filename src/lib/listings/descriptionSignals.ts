/**
 * descriptionSignals — the ready-made "In the description" filters (§4: deterministic).
 *
 * Each signal is a named set of word patterns run over a listing's public remarks in the
 * nightly ETL. The ids that match are written to the `description_signals` string[] facet
 * on the Typesense document, so the Filters panel can show a live count per signal and
 * the terminal can filter on them with plain filter_by — no full-text query, no AI.
 *
 * WHY CURATED PATTERNS, NOT JUST THE FREE-TEXT BOX. Agents write the same feature a dozen
 * ways ("separate entrance", "sep. side entrance", "private entrance"); a reader typing one
 * spelling misses the rest. A signal carries every spelling, and its exclusions, once.
 *
 * RULES CARRIED OVER FROM distressSignals.ts (read its header before adding a signal):
 *  - "real estate" is stripped before anything reads "estate".
 *  - Agent puffery ("motivated seller", "priced to sell") is never a signal.
 *  - "as-is" is not a signal: it is a warranty disclaimer, usually about the appliances.
 *  - Patterns are non-global (`.test()` on a /g regex is stateful).
 * The forced-sale and needs-work patterns are imported from distressSignals, never copied,
 * so the distress flag and these filters can never disagree about what "power of sale" is.
 *
 * CHANGING A SIGNAL. Edit this file, add real-description test cases (including ones that
 * must NOT match), merge, then run scripts/admin/backfillDescriptionSearch.ts: the nightly
 * sync only re-transforms listings modified that day, so without the backfill the rest of
 * the index keeps the old tags.
 */

import type { PersonaType } from "@/lib/personas/personaConfig";
import { FORCED_SALE, NEEDS_WORK, type Signal } from "./distressSignals";

export type DescriptionSignalId =
  | "separate_entrance"
  | "second_suite"
  | "legal_second_unit"
  | "walkout_basement"
  | "tenanted"
  | "power_of_sale"
  | "estate_sale"
  | "needs_work"
  | "vendor_take_back"
  | "assignment";

export interface DescriptionSignal {
  id: DescriptionSignalId;
  /** Checklist and chip text. */
  label: string;
  patterns: RegExp[];
  /**
   * What a reader might TYPE in the search box to mean this signal. Matched against the
   * whole typed string, normalised, so "sep entrance" offers the signal (which also finds
   * "private side entrance") instead of a literal word search that would miss it.
   */
  aliases: string[];
}

const pick = (list: Signal[], labels: string[]): RegExp[] =>
  list.filter((s) => labels.includes(s.label)).map((s) => s.pattern);

export const DESCRIPTION_SIGNALS: readonly DescriptionSignal[] = [
  {
    id: "separate_entrance",
    label: "Separate entrance",
    patterns: [
      /\bseparate\s+(side\s+|rear\s+|private\s+|basement\s+)?entrance\b/,
      /\bsep\.?\s+(side\s+|rear\s+)?entrance\b/,
      /\bprivate\s+(side\s+|rear\s+)?entrance\s+to\s+(the\s+)?(basement|bsmt|lower)/,
    ],
    aliases: ["separate entrance", "sep entrance", "separate side entrance", "side entrance", "private entrance"],
  },
  {
    id: "second_suite",
    label: "In-law / second suite",
    patterns: [
      /\bin[\s-]?law\s+(suite|apartment|apt|unit)\b/,
      /\b(basement|bsmt|lower[\s-]level)\s+(apartment|apt|suite|unit)\b/,
      /\bsecond(ary)?\s+(suite|unit|dwelling)\b/,
      /\b2nd\s+(suite|unit|kitchen)\b/,
      /\bsecond\s+kitchen\b/,
      /\bnanny\s+suite\b/,
      /\bmulti[\s-]?generational\b/,
    ],
    aliases: ["in law suite", "inlaw suite", "in-law", "second suite", "basement apartment", "second unit", "2nd kitchen", "second kitchen", "nanny suite"],
  },
  {
    id: "legal_second_unit",
    label: "Legal duplex / second unit",
    patterns: [
      /\blegal\s+(duplex|triplex|fourplex|two[\s-]unit|2[\s-]unit|three[\s-]unit|3[\s-]unit)\b/,
      /\blegal\s+(basement\s+)?(apartment|apt|suite|unit)\b/,
      /\blegal\s+(second|2nd|secondary)\s+(suite|unit|dwelling)\b/,
      /\bregistered\s+(second|2nd|secondary|basement)\s+(suite|unit|apartment)\b/,
    ],
    aliases: ["legal duplex", "legal basement", "legal second unit", "legal suite", "registered second unit"],
  },
  {
    id: "walkout_basement",
    label: "Walk-out basement",
    patterns: [
      // "walk-out to the deck" is a kitchen door, not a basement. Only the basement forms.
      /\bwalk[\s-]?out\s+(basement|bsmt|lower[\s-]level)\b/,
      /\b(basement|bsmt|lower[\s-]level)\s+(with\s+(a\s+)?)?walk[\s-]?out\b/,
      /\bwalk[\s-]?up\s+(basement|bsmt)\b/,
    ],
    aliases: ["walkout basement", "walk out basement", "walk-out basement", "walkup basement"],
  },
  {
    id: "tenanted",
    label: "Tenanted",
    patterns: [
      /\btenanted\b/,
      /\b(currently|presently)\s+(rented|leased|tenanted)\b/,
      /\btenants?\s+(in\s+place|pay(s|ing)?|occupied|on\s+month[\s-]to[\s-]month)\b/,
      /\bexisting\s+tenants?\b/,
      /\btenant[\s-]occupied\b/,
    ],
    aliases: ["tenanted", "tenants", "tenant", "currently rented", "existing tenants"],
  },
  {
    id: "power_of_sale",
    label: "Power of sale",
    patterns: pick(FORCED_SALE, ["Power of Sale", "Foreclosure", "Bank Owned", "Court-Ordered Sale", "Receivership"]),
    aliases: ["power of sale", "pos", "foreclosure", "bank owned", "court ordered", "receivership"],
  },
  {
    id: "estate_sale",
    label: "Estate sale",
    patterns: pick(FORCED_SALE, ["Estate Sale", "Probate"]),
    aliases: ["estate sale", "estate", "probate", "executor"],
  },
  {
    id: "needs_work",
    label: "Needs work",
    patterns: NEEDS_WORK.map((s) => s.pattern),
    aliases: ["handyman", "handyman special", "fixer upper", "needs work", "tlc", "contractor special", "renovator special", "teardown"],
  },
  {
    id: "vendor_take_back",
    label: "Vendor take-back",
    patterns: [/\bvendor\s+take[\s-]?back\b/, /\bvtb\b/, /\bseller\s+financing\b/],
    aliases: ["vendor take back", "vtb", "seller financing"],
  },
  {
    id: "assignment",
    label: "Assignment sale",
    patterns: [
      /\bassignment\s+sale\b/,
      /\bassignment\s+of\s+(the\s+)?(agreement|aps|purchase)\b/,
      /\b(this\s+is\s+an|offered\s+as\s+an)\s+assignment\b/,
    ],
    aliases: ["assignment", "assignment sale"],
  },
];

export const SIGNAL_BY_ID: Record<DescriptionSignalId, DescriptionSignal> = Object.fromEntries(
  DESCRIPTION_SIGNALS.map((s) => [s.id, s])
) as Record<DescriptionSignalId, DescriptionSignal>;

export function isDescriptionSignalId(v: unknown): v is DescriptionSignalId {
  return typeof v === "string" && v in SIGNAL_BY_ID;
}

/** Checklist order per persona: the signals that reader came for, first. */
export const SIGNAL_ORDER: Record<PersonaType, readonly DescriptionSignalId[]> = {
  smart: ["separate_entrance", "second_suite", "legal_second_unit", "walkout_basement", "needs_work", "estate_sale", "power_of_sale", "tenanted", "vendor_take_back", "assignment"],
  cashflow: ["legal_second_unit", "second_suite", "separate_entrance", "tenanted", "vendor_take_back", "power_of_sale", "estate_sale", "walkout_basement", "needs_work", "assignment"],
  flippers: ["power_of_sale", "estate_sale", "needs_work", "vendor_take_back", "assignment", "tenanted", "separate_entrance", "second_suite", "legal_second_unit", "walkout_basement"],
  builders: ["needs_work", "estate_sale", "power_of_sale", "legal_second_unit", "separate_entrance", "second_suite", "walkout_basement", "vendor_take_back", "tenanted", "assignment"],
};

/** Lower-case and strip "real estate", exactly as detectDistress does before matching. */
function normaliseRemarks(remarks: string): string {
  return remarks.toLowerCase().replace(/\breal\s+estate\b/g, " ");
}

/**
 * The signal ids a description carries, in registry order. Empty for a missing, blank or
 * non-string description — the ETL writes `[]` so Typesense always sees the field (§6).
 */
export function detectDescriptionSignals(remarks: string | null | undefined): DescriptionSignalId[] {
  if (typeof remarks !== "string" || remarks.trim() === "") return [];
  const text = normaliseRemarks(remarks);
  return DESCRIPTION_SIGNALS.filter((s) => s.patterns.some((p) => p.test(text))).map((s) => s.id);
}

const normQuery = (q: string) =>
  q
    .toLowerCase()
    .replace(/["“”]/g, "")
    .replace(/[-–]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * The signal a typed search string means, if it means one. The whole string must equal an
 * alias (after normalising quotes, hyphens and spacing) — "estate" offers Estate sale, but
 * "estate lot in king city" does not, because a reader who typed a sentence meant the sentence.
 */
export function signalForQuery(q: string): DescriptionSignal | null {
  const n = normQuery(q);
  if (n.length < 3) return null;
  return DESCRIPTION_SIGNALS.find((s) => s.aliases.some((a) => normQuery(a) === n)) ?? null;
}
