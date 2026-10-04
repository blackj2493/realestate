/**
 * The "save this home?" hand-off between signup and the listing a visitor signed up from.
 *
 * WHY IT EXISTS. Measured 2026-10-04 over 422 real signups: a reader who saved a HOME on
 * their signup day came back on a later day at 81% (16 users), against 33-34% for one who
 * saved only an area or nothing. A visitor who signs up from a listing page has already
 * told us which home they care about — the cheapest saved home there is to get.
 *
 * HOW. AcceptTermsForm marks the listing key just before it returns the reader to `next`;
 * the listing page consumes the mark once and offers a one-tap save. sessionStorage, not
 * localStorage: the offer belongs to this signup in this tab, and must never resurface on a
 * later visit. The mark expires so a tab left open does not ask an hour later.
 *
 * Storage is injected so the logic tests without a DOM; every access is guarded because
 * private mode and blocked storage throw, and a missed offer is never worth an error.
 */

const KEY = "pp_save_offer";
export const SAVE_OFFER_TTL_MS = 10 * 60 * 1000;

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function sessionStore(): Store | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** Listing keys are upper-case MLS numbers; a URL can carry either case. */
const norm = (k: string) => k.trim().toUpperCase();

export function markSaveOffer(listingKey: string, now = Date.now(), store = sessionStore()): void {
  if (!store || !listingKey) return;
  try {
    store.setItem(KEY, JSON.stringify({ key: norm(listingKey), at: now }));
  } catch {
    /* quota / private mode — the reader simply is not asked */
  }
}

/**
 * True when this listing is the one the reader just signed up from. Consumes the mark
 * either way once it is read for the listing it names, so it fires at most once. A mark for
 * a different listing is left alone: client navigation can render another listing first.
 */
export function takeSaveOffer(listingKey: string, now = Date.now(), store = sessionStore()): boolean {
  if (!store || !listingKey) return false;
  try {
    const raw = store.getItem(KEY);
    if (!raw) return false;
    const mark = JSON.parse(raw) as { key?: unknown; at?: unknown };
    const fresh = typeof mark.at === "number" && now - mark.at >= 0 && now - mark.at < SAVE_OFFER_TTL_MS;
    if (!fresh) {
      store.removeItem(KEY);
      return false;
    }
    if (typeof mark.key !== "string" || mark.key !== norm(listingKey)) return false;
    store.removeItem(KEY);
    return true;
  } catch {
    return false;
  }
}
