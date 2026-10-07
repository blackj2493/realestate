/**
 * The one-time ask to narrow a whole-city area (all of Toronto, all of Ottawa) to a part.
 *
 * WHY. Toronto and Ottawa are now offered as parts at signup (cityParts.ts), but readers who
 * signed up before that still follow the whole city. On 2026-10-05 that was 85 Toronto and 9
 * Ottawa readers still receiving email — the group that unsubscribes at 35.5%. Most of them
 * read only the email, so the ask rides on the digest they already get (no extra send), and
 * the app shows the same ask to the few who visit.
 *
 * RULES (owner-approved 2026-10-05):
 *   - At most MAX_ASKS emails carry it; the first also puts it in the subject line, so a
 *     reader who only skims the inbox sees it.
 *   - Any answer ends it: a part ('switched') or "keep all of Toronto" ('kept').
 *   - Nothing changes without a click. An unanswered reader keeps the whole city; the
 *     dormant-reader rule (digestCadence.ts) already holds them to a weekly email.
 *   - Picking a part REPLACES the city (replaceRegion), because the point is less volume.
 *
 * Pure: no I/O, so the worker, the routes and the tests share one definition.
 */

import { partForCity, partsOf, type CityPart } from "@/lib/dashboard/cityParts";

/** Emails that may carry the ask before it stops for good. */
export const MAX_ASKS = 3;

/** Opens in one part before we are willing to say "most of the homes you opened are here". */
export const MIN_OPENS_FOR_SUGGESTION = 3;

export interface NarrowAskState {
  shown_count: number;
  resolved: "switched" | "kept" | null;
}

/** The whole city a saved region names, when that city is offered in parts; else null. */
export function wholeCityToNarrow(region: string): string | null {
  const name = (region ?? "").trim();
  if (!name) return null;
  for (const city of ["Toronto", "Ottawa"]) {
    if (name.toLowerCase() === city.toLowerCase() && partsOf(city)) return city;
  }
  return null;
}

/** May this email carry the ask? Unanswered, and asked fewer than MAX_ASKS times. */
export function shouldAsk(state: NarrowAskState | null): boolean {
  if (!state) return true;
  if (state.resolved) return false;
  return state.shown_count < MAX_ASKS;
}

/**
 * The part most of a reader's opened homes sit in, from feed City values → open counts
 * ({ "Toronto W06": 7, "Toronto W08": 2, "Mississauga": 4 }). Only counts homes inside
 * `city`, and only answers when that part has at least MIN_OPENS_FOR_SUGGESTION opens and
 * more than any other part (a tie is no suggestion: we would be guessing).
 */
export function suggestPart(city: string, opensByFeedCity: Record<string, number>): CityPart | null {
  const parts = partsOf(city);
  if (!parts) return null;
  const byPart = new Map<string, number>();
  for (const [feedCity, n] of Object.entries(opensByFeedCity)) {
    const part = partForCity(feedCity);
    if (!part || !parts.includes(part) || !(n > 0)) continue;
    byPart.set(part.name, (byPart.get(part.name) ?? 0) + n);
  }
  const ranked = [...byPart.entries()].sort((a, b) => b[1] - a[1]);
  if (!ranked.length || ranked[0][1] < MIN_OPENS_FOR_SUGGESTION) return null;
  if (ranked[1] && ranked[1][1] === ranked[0][1]) return null;
  return parts.find((p) => p.name === ranked[0][0]) ?? null;
}

/**
 * Subject line for the email that carries the FIRST ask, in the house ticker format
 * (docs/brand/voice.md §5: facts, middot-separated, numbers first, never a question).
 * Later asks keep the digest's normal subject.
 */
export function narrowAskSubject(city: string, newCount: number, period: "night" | "week"): string {
  const n = Math.max(0, Math.round(newCount)).toLocaleString("en-CA");
  return `${city} · ${n} new homes ${period === "night" ? "tonight" : "this week"} · pick your part`;
}
