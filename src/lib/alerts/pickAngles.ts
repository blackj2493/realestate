/**
 * Angle picks for an UNFILTERED area section of the nightly digest — pure (§4).
 *
 * WHY. A reader who never saved a filter got six rows of address · price · beds, the same
 * thing a Realtor.ca alert sends, with a $400k condo beside a $1.4M detached and nothing
 * saying why either was there. The rows were already ranked (pickRank), but the reason was
 * invisible, so the list read as random and the readers unsubscribed.
 *
 * WHAT. One home per ANGLE instead of six homes off one ranking. The angles are the
 * dashboard's own boards (src/lib/dashboard/boards.ts) applied to tonight's new listings:
 * price drops, suite candidates, lowest monthly burn, highest True DOM, highest cap rate —
 * plus a land angle for builders. Each picked row carries one line saying why it won.
 *
 * ORDER. Set by the reader's persona. Homebuyers are the default and by far the largest
 * group, so the `smart` order is what most inboxes get; investors and builders reorder.
 *
 * COMPLIANCE. VOW Agreement §(f) allows derivative analytics built from VOW data only
 * "on their VOW(s)" — the password-protected site. Email is not that site. So:
 *  - Printed in full: price cut (IDX), monthly burn (list price + tax + fees, IDX), suite
 *    signals and lot size (listing fields, IDX). The listing page shows all of these to
 *    signed-out visitors.
 *  - Tease only, never the number: True DOM (stitched from off-market campaign history)
 *    and cap rate (rent from closed leases where available). Same rule digest.ts applies
 *    to sold prices: they may ORDER a pick; the figure stays behind sign-in.
 */

import type { PersonaType } from "@/lib/personas/personaConfig";
import { capRateOrNull } from "@/lib/metrics/sanityBand";
import { comparePicks } from "./pickRank";

/** Per-listing signals the angles read. All optional: the feed is dirty (CLAUDE.md §6). */
export interface ListingSignals {
  /** 'NONE' | 'POTENTIAL_CANDIDATE' | 'EXISTING_SUITE' (transformer analyzeSuitePotential). */
  suiteStatus?: string | null;
  /** 0–6. */
  suiteScore?: number | null;
  /** BasementType tokens, e.g. ["Finished", "Separate Entrance"]. */
  basement?: string[] | null;
  /** CapitalBurnRateMonthly: mortgage + tax + fees + insurance, 20% down at 5%. */
  burnMonthly?: number | null;
  /** TrueDom in days — orders the negotiate angle, NEVER printed. */
  trueDom?: number | null;
  /** cap_rate_est in percent — orders the rental angle, NEVER printed. */
  capRate?: number | null;
  lotWidthFt?: number | null;
  lotDepthFt?: number | null;
  /** BuilderAnalyticsEngine: ≥80 ft × ≥100 ft on municipal services. */
  severance?: boolean | null;
}

/** The fields this module needs from a NewListingAlert (kept structural to avoid a cycle). */
export interface AngleCandidate {
  listing_key: string;
  entryMs: number;
  score?: number | null;
  priceCut?: number | null;
  signals?: ListingSignals | null;
}

export type AngleId = "price_cut" | "suite" | "low_cost" | "negotiate" | "rental" | "land";

/** How a reason line renders: a gain, a cut, or a sign-in tease. */
export type ReasonTone = "good" | "cut" | "lock";

export interface AngleCopy {
  /** Section heading. */
  title: string;
  /** One line under the heading saying what the angle means. */
  blurb: string;
}

export const ANGLE_COPY: Record<AngleId, AngleCopy> = {
  price_cut: { title: "Biggest price cut", blurb: "Sellers who have already come down" },
  suite: { title: "Suite potential", blurb: "Room for a second unit that helps pay the mortgage" },
  low_cost: {
    title: "Lowest monthly cost",
    blurb: "Mortgage, tax, fees and insurance, with 20% down at 5%",
  },
  negotiate: { title: "Room to negotiate", blurb: "Homes that may have been for sale longer than they look" },
  rental: { title: "Rental numbers", blurb: "The strongest rent against asking price tonight" },
  land: { title: "Land & lot size", blurb: "Lots that carry more than the house on them" },
};

/**
 * Angle order per persona. Four sections at most — the email used to carry six rows, and
 * four that each say why they are there beat six that do not.
 */
export const PERSONA_ANGLES: Record<PersonaType, readonly AngleId[]> = {
  smart: ["price_cut", "suite", "low_cost", "negotiate"],
  cashflow: ["rental", "low_cost", "suite", "price_cut"],
  flippers: ["price_cut", "negotiate", "low_cost", "suite"],
  builders: ["land", "negotiate", "suite", "price_cut"],
};

/** Plausible monthly burn. Below is a parking spot or a data fault; above is not a home. */
export const BURN_BAND = { min: 500, max: 30_000 } as const;
/** Negotiate angle: True DOM at least this long… */
export const NEGOTIATE_MIN_TRUE_DOM = 60;
/** …and at least this many days longer than the current listing has existed. */
export const NEGOTIATE_MIN_HIDDEN_DAYS = 30;
/** Land angle: frontage worth naming. 50 ft is density_play LOW in BuilderAnalyticsEngine. */
export const LAND_MIN_WIDTH_FT = 50;
/** Above this a "frontage" is acreage or a unit error, not a lot to lead with. */
export const LAND_MAX_WIDTH_FT = 400;

const DAY_MS = 86_400_000;

const finite = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : Number(v);
  return v != null && Number.isFinite(n) ? n : null;
};

const SUITE_STATUSES = new Set(["EXISTING_SUITE", "POTENTIAL_CANDIDATE"]);

function burnOf(l: AngleCandidate): number | null {
  const b = finite(l.signals?.burnMonthly);
  return b != null && b >= BURN_BAND.min && b <= BURN_BAND.max ? b : null;
}

/** Days the TRUE run exceeds the current listing's own age; null when it does not qualify. */
function hiddenDays(l: AngleCandidate, nowMs: number): number | null {
  const dom = finite(l.signals?.trueDom);
  if (dom == null || dom < NEGOTIATE_MIN_TRUE_DOM) return null;
  const listedDays = l.entryMs > 0 ? Math.max(0, (nowMs - l.entryMs) / DAY_MS) : 0;
  const hidden = dom - listedDays;
  return hidden >= NEGOTIATE_MIN_HIDDEN_DAYS ? hidden : null;
}

function lotWidth(l: AngleCandidate): number | null {
  const w = finite(l.signals?.lotWidthFt);
  return w != null && w >= LAND_MIN_WIDTH_FT && w <= LAND_MAX_WIDTH_FT ? w : null;
}

/**
 * Each angle: does this listing qualify, and how do two qualifiers compare (negative
 * means `a` is the better pick). Ties fall to comparePicks — best-priced, then newest.
 */
type AngleRule = {
  qualifies: (l: AngleCandidate, nowMs: number) => boolean;
  compare: (a: AngleCandidate, b: AngleCandidate, nowMs: number) => number;
};

const RULES: Record<AngleId, AngleRule> = {
  price_cut: {
    qualifies: (l) => finite(l.priceCut) != null && (l.priceCut as number) > 0,
    compare: (a, b) => (b.priceCut as number) - (a.priceCut as number),
  },
  suite: {
    qualifies: (l) => SUITE_STATUSES.has(l.signals?.suiteStatus ?? ""),
    compare: (a, b) => {
      const ea = a.signals?.suiteStatus === "EXISTING_SUITE" ? 1 : 0;
      const eb = b.signals?.suiteStatus === "EXISTING_SUITE" ? 1 : 0;
      if (ea !== eb) return eb - ea;
      return (finite(b.signals?.suiteScore) ?? 0) - (finite(a.signals?.suiteScore) ?? 0);
    },
  },
  low_cost: {
    qualifies: (l) => burnOf(l) != null,
    compare: (a, b) => (burnOf(a) as number) - (burnOf(b) as number),
  },
  negotiate: {
    qualifies: (l, now) => hiddenDays(l, now) != null,
    compare: (a, b, now) => (hiddenDays(b, now) as number) - (hiddenDays(a, now) as number),
  },
  rental: {
    qualifies: (l) => capRateOrNull(finite(l.signals?.capRate)) != null,
    compare: (a, b) => (finite(b.signals?.capRate) as number) - (finite(a.signals?.capRate) as number),
  },
  land: {
    qualifies: (l) => lotWidth(l) != null,
    compare: (a, b) => {
      const sa = a.signals?.severance ? 1 : 0;
      const sb = b.signals?.severance ? 1 : 0;
      if (sa !== sb) return sb - sa;
      return (lotWidth(b) as number) - (lotWidth(a) as number);
    },
  },
};

export interface AnglePick<T extends AngleCandidate = AngleCandidate> {
  angle: AngleId;
  listing: T;
}

/**
 * One listing per angle, in the persona's order. A listing is used once — the first angle
 * that wants it keeps it, so the four sections are four different homes. An angle with no
 * qualifier is skipped rather than padded. Empty result means "fall back to the plain rows".
 */
export function pickAngles<T extends AngleCandidate>(
  listings: readonly T[],
  persona: PersonaType,
  nowMs: number
): AnglePick<T>[] {
  const order = PERSONA_ANGLES[persona] ?? PERSONA_ANGLES.smart;
  const used = new Set<string>();
  const picks: AnglePick<T>[] = [];
  for (const angle of order) {
    const rule = RULES[angle];
    let best: T | null = null;
    for (const l of listings) {
      if (used.has(l.listing_key) || !rule.qualifies(l, nowMs)) continue;
      if (!best) {
        best = l;
        continue;
      }
      const c = rule.compare(l, best, nowMs);
      if (c < 0 || (c === 0 && comparePicks(l, best) < 0)) best = l;
    }
    if (best) {
      used.add(best.listing_key);
      picks.push({ angle, listing: best });
    }
  }
  return picks;
}

// ── Reason lines ────────────────────────────────────────────────────────────

const money = (n: number) => `$${Math.round(n).toLocaleString("en-CA")}`;

/** "$80K", "$1.2M" — for subject lines, where a full figure is too long. */
function shortMoney(n: number): string {
  if (n >= 1_000_000) return `$${(Math.round(n / 100_000) / 10).toString()}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return money(n);
}

/** Readable basement features, in a fixed order, from the BasementType tokens. */
function basementDetail(tokens: string[] | null | undefined): string | null {
  const has = new Set((tokens ?? []).map((t) => String(t).trim().toLowerCase()));
  const parts: string[] = [];
  if (has.has("separate entrance")) parts.push("separate entrance");
  if (has.has("apartment")) parts.push("basement apartment");
  else if (has.has("finished")) parts.push("finished basement");
  if (has.has("walk-out") || has.has("walkout")) parts.push("walk-out");
  if (parts.length === 0) return null;
  const s = parts.join(" + ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export interface AngleReason {
  text: string;
  tone: ReasonTone;
}

/**
 * The one line under a picked row. Every number in it is IDX; the two VOW-ordered angles
 * print a sign-in line and no figure at all.
 */
export function angleReason(pick: AnglePick): AngleReason {
  const l = pick.listing;
  const s = l.signals ?? {};
  switch (pick.angle) {
    case "price_cut":
      return { text: `Cut ${money(l.priceCut as number)} since it first listed`, tone: "cut" };
    case "suite": {
      const detail = basementDetail(s.basement);
      if (s.suiteStatus === "EXISTING_SUITE")
        return { text: detail ? `Second unit already in place · ${detail}` : "Second unit already in place", tone: "good" };
      return { text: detail ?? "Layout suits a basement suite", tone: "good" };
    }
    case "low_cost":
      return { text: `About ${money(burnOf(l) as number)}/mo to own`, tone: "good" };
    case "negotiate":
      return { text: "Sign in to see its true days on market", tone: "lock" };
    case "rental":
      return { text: "Sign in to see its cap rate and cash flow", tone: "lock" };
    case "land": {
      const w = Math.round(lotWidth(l) as number);
      const d = finite(s.lotDepthFt);
      const size = d != null && d > 0 && d <= 2_000 ? `${w} × ${Math.round(d)} ft lot` : `${w} ft frontage`;
      return { text: s.severance ? `${size} · possible severance` : size, tone: "good" };
    }
  }
}

/** A short noun phrase for the subject line: "an $80K price cut", "a 60 ft lot". */
export function angleSubjectPhrase(pick: AnglePick): string {
  const l = pick.listing;
  switch (pick.angle) {
    case "price_cut": {
      const p = shortMoney(l.priceCut as number);
      // "an $80K", "an $11K", "a $110K": the article follows how the figure is SAID —
      // eight…, eleven, eighteen take "an"; one-hundred-and-ten does not.
      return `${/^\$(8|1[18](?![0-9]))/.test(p) ? "an" : "a"} ${p} price cut`;
    }
    case "suite":
      return l.signals?.suiteStatus === "EXISTING_SUITE" ? "a home with a second unit" : "a suite-ready home";
    case "low_cost":
      return `a home at ${money(burnOf(l) as number)}/mo`;
    case "negotiate":
      return "a home with room to negotiate";
    case "rental":
      return "a rental pick";
    case "land":
      return `a ${Math.round(lotWidth(l) as number)} ft lot`;
  }
}
