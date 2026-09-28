/**
 * Which locked surface sent a visitor to /login, read off the `next` destination.
 *
 * WHY THIS EXISTS. /login used to greet every visitor with the same line — "Sign in to
 * sync your watchlist across devices and receive market alerts" — whatever they had just
 * clicked. PostHog (2026-09-28): 1,831 people saw /login in 30 days and 84 of them pressed
 * any sign-in button. The visitor arrived wanting ONE thing (this home's sold price, the
 * trends for this city) and the page named neither. `next` already says what that thing
 * was, so the page can say it back.
 *
 * Pure URL parsing, no I/O — /login does the listing lookup for the address line.
 * The `gate` string is also sent to PostHog (`auth_login_viewed`), so a funnel can be
 * broken down by which locked surface converts.
 */

import { extractListingKey, deslugCity } from "@/lib/listings/listingPath";

export type LoginGate =
  /** A listing page — active or sold. The key resolves to an address line. */
  | { gate: "listing"; listingKey: string }
  /** A sold / off-market address page. */
  | { gate: "address"; listingKey: string | null; city: string | null }
  | { gate: "analytics" }
  | { gate: "home_value" }
  | { gate: "reno" }
  | { gate: "compare" }
  /** Bare /login, /dashboard, or anything that names nothing in particular. */
  | { gate: "none" };

function pathOf(dest: string): string {
  const cut = dest.search(/[?#]/);
  return cut === -1 ? dest : dest.slice(0, cut);
}

export function loginGateFromNext(next: string | null | undefined): LoginGate {
  // Same open-redirect shape as postSignInPath: relative, single-slash paths only.
  if (!next || !next.startsWith("/") || next.startsWith("//")) return { gate: "none" };
  const segments = pathOf(next).split("/").filter(Boolean);
  const [first] = segments;

  if (first === "properties") {
    if (segments[1] === "compare") return { gate: "compare" };
    if (segments.length === 2) {
      const listingKey = extractListingKey(segments[1]);
      return listingKey ? { gate: "listing", listingKey } : { gate: "none" };
    }
    return { gate: "none" };
  }

  // Canonical listing URL: /property/on/{city}/{street-slug}-{KEY}. Hub pages at the same
  // depth (/property/on/{city}/{neighbourhood}) carry no key and fall through to "none".
  if (first === "property" && segments.length === 4) {
    const listingKey = extractListingKey(segments[3]);
    return listingKey ? { gate: "listing", listingKey } : { gate: "none" };
  }

  if (first === "address" && segments.length === 4) {
    const city = deslugCity(segments[2]).trim() || null;
    return { gate: "address", listingKey: extractListingKey(segments[3]), city };
  }

  if (first === "analytics") return { gate: "analytics" };
  if (first === "hidden-equity" || first === "avm") return { gate: "home_value" };
  if (first === "whats-my-home-hiding") return { gate: "reno" };

  return { gate: "none" };
}

/** "35 Mariner Terrace 139, Toronto, ON M5V 3V9" → "35 Mariner Terrace 139". */
export function streetLine(unparsedAddress: unknown): string | null {
  if (typeof unparsedAddress !== "string") return null;
  const line = unparsedAddress.split(",")[0]?.trim();
  return line ? line : null;
}

export interface LoginCopy {
  heading: string;
  subheading: string;
}

/**
 * The words /login shows for a gate. `place` is the street line when the lookup found one.
 * Voice: terse, no exclamation marks, name the thing they came for (docs/brand/voice.md).
 */
export function loginCopy(gate: LoginGate, place: string | null): LoginCopy {
  switch (gate.gate) {
    case "listing":
      return {
        heading: "Unlock this home",
        subheading: `Create a free account to see the sale history, sold comparables and estimated value of ${place ?? "this home"}.`,
      };
    case "address":
      return {
        heading: "See the sold price",
        subheading: `Create a free account to see what ${place ?? (gate.city ? `this ${gate.city} home` : "this home")} sold for, when, and every earlier sale.`,
      };
    case "analytics":
      return {
        heading: "Open Market Trends",
        subheading: "Create a free account to see sold-price trends, days on market and over-asking rates by area.",
      };
    case "home_value":
      return {
        heading: "See what your home is worth",
        subheading: "Create a free account to get a value estimate built from real sold prices near you.",
      };
    case "reno":
      return {
        heading: "See the renovation upside",
        subheading: "Create a free account to see how much a renovation could add to a typical home here, from real sold prices.",
      };
    case "compare":
      return {
        heading: "Compare with sold data",
        subheading: "Create a free account to compare these homes side by side, with sold prices and value estimates.",
      };
    case "none":
      return {
        heading: "See sold prices",
        subheading: "Create a free account to see what homes actually sold for, not only what they were listed at.",
      };
  }
}
