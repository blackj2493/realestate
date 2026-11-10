/**
 * promptGate — the one rule set for the floating cards (the first-run tour card and
 * the "add to home screen" card) and the Guide launcher's "what's new" badge.
 *
 * Before this, each card decided on its own, so a brand-new visitor could get the tour
 * card, the install card and a red "6" badge together, over the page's own sign-up
 * button. The rules now:
 *
 *  1. No card on the visitor's first page view on this device. The page and its own
 *     sign-up button get the first screen to themselves.
 *  2. At most one card per page view. A card that closes does not hand the slot to the
 *     next card on the same page; the next one waits for a later page.
 *  3. The install card is for signed-in visitors only. A signed-out visitor has no
 *     dashboard or watchlist to come back to, so "one tap to your dashboard" is empty.
 *  4. The tour card never sits over a page that is locked for a signed-out visitor
 *     (today: the dashboard).
 *  5. The "what's new" badge is for signed-in visitors only. A new visitor never saw
 *     the old features, so "6 new" means nothing to them.
 *
 * Durable state: a page-view count in localStorage `pp_page_views`. Ephemeral state:
 * which path has already shown a card in this page view.
 */

"use client";

import { create } from "zustand";
import type { DiscoverySurface } from "@/lib/discovery/featureRegistry";

export const PAGE_VIEWS_KEY = "pp_page_views";

/** Surfaces that a signed-out visitor sees as a full-page sign-in lock. */
export const LOCKED_WHEN_SIGNED_OUT: ReadonlySet<DiscoverySurface> = new Set<DiscoverySurface>([
  "dashboard",
  "analytics",
]);

export type PromptCard = "tour" | "install";

export interface GateInput {
  card: PromptCard;
  /** Page views on this device, including the current one. */
  pageViews: number;
  signedIn: boolean;
  surface: DiscoverySurface;
  /** true when another card has already shown on this page view. */
  slotTaken: boolean;
}

/** Pure: may this card appear now? (Each card still applies its own rules on top.) */
export function mayShowCard(i: GateInput): boolean {
  if (i.pageViews < 2) return false;
  if (i.slotTaken) return false;
  if (i.card === "install") return i.signedIn;
  // tour
  if (!i.signedIn && LOCKED_WHEN_SIGNED_OUT.has(i.surface)) return false;
  return true;
}

/** Pure: may the launcher show its "what's new" count? */
export function mayShowNewBadge(signedIn: boolean): boolean {
  return signedIn;
}

export function parsePageViews(raw: string | null): number {
  const n = raw === null ? 0 : Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

interface PromptGateState {
  hydrated: boolean;
  pageViews: number;
  /** The path whose page view counted last (guards double effects on one view). */
  countedPath: string | null;
  /** The path on which a card has shown in the current page view, if any. */
  slotPath: string | null;
  /** Which card holds that slot. */
  slotCard: PromptCard | null;
  /** Count a page view for `path` (no-op when that view is already counted). */
  countView: (path: string) => void;
  /** Mark the current page view's card slot as used by `card`. */
  claimSlot: (path: string, card: PromptCard) => void;
}

/** true when a card other than `card` has used the slot for `path`. */
export function slotTakenBy(
  s: Pick<PromptGateState, "slotPath" | "slotCard">,
  path: string,
  card: PromptCard
): boolean {
  return s.slotPath === path && s.slotCard !== null && s.slotCard !== card;
}

export const usePromptGate = create<PromptGateState>((set, get) => ({
  hydrated: false,
  pageViews: 0,
  countedPath: null,
  slotPath: null,
  slotCard: null,

  countView: (path) => {
    if (typeof window === "undefined") return;
    const s = get();
    if (s.hydrated && s.countedPath === path) return;
    let base = s.pageViews;
    if (!s.hydrated) {
      try {
        base = parsePageViews(window.localStorage.getItem(PAGE_VIEWS_KEY));
      } catch {
        /* storage blocked — treat as a first view */
      }
    }
    const pageViews = base + 1;
    try {
      window.localStorage.setItem(PAGE_VIEWS_KEY, String(pageViews));
    } catch {
      /* storage blocked — the count lives for this tab only */
    }
    set({ hydrated: true, pageViews, countedPath: path, slotPath: null, slotCard: null });
  },

  claimSlot: (path, card) => {
    const s = get();
    if (s.slotPath !== path) set({ slotPath: path, slotCard: card });
  },
}));
