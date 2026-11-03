/**
 * When to offer "save this home?" because the reader has SHOWN interest in it (2026-11).
 *
 * WHY. A reader who saves a home comes back: 9 of 9 tracked signups who saved one returned on
 * a later day, against 37% of those who did not (PostHog, 2026-11-03). Yet only ~10% of users
 * ever save, and both existing prompts convert badly: the generic map card 3 of 107, the
 * after-signup offer 1 of 20 — a reader who just signed up came to SEE a price, not to commit.
 * A second visit to the same home is a far stronger signal, and it is common: signed-in
 * readers opened the same listing 2+ times in ~470 cases in 30 days.
 *
 * Two triggers, each offered at most once per home:
 *  - "repeat_view": this browser has opened this listing on an earlier VISIT (views less than
 *    30 minutes apart are one visit, so a refresh or a back-button never counts twice);
 *  - "from_email": the reader arrived from one of our emails (utm_medium=email), i.e. they
 *    clicked this home in a digest or an alert.
 *
 * localStorage, capped, every access guarded: a missed offer is never worth an error.
 */

const KEY = "pp_listing_interest";
const MAX_ENTRIES = 300;
export const VISIT_GAP_MS = 30 * 60 * 1000;

type Store = Pick<Storage, "getItem" | "setItem">;
interface Entry {
  visits: number;
  last: number;
  offered?: boolean;
}
type Book = Record<string, Entry>;

function localStore(): Store | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

const norm = (k: string) => k.trim().toUpperCase();

function read(store: Store): Book {
  try {
    const raw = store.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    return parsed && typeof parsed === "object" ? (parsed as Book) : {};
  } catch {
    return {};
  }
}

function write(store: Store, book: Book): void {
  const keys = Object.keys(book);
  if (keys.length > MAX_ENTRIES) {
    // Drop the least recently seen homes first.
    keys.sort((a, b) => book[a].last - book[b].last);
    for (const k of keys.slice(0, keys.length - MAX_ENTRIES)) delete book[k];
  }
  try {
    store.setItem(KEY, JSON.stringify(book));
  } catch {
    /* quota / private mode */
  }
}

/** Count this page view as a visit (unless it is within VISIT_GAP_MS of the last one). */
export function recordListingVisit(listingKey: string, now = Date.now(), store = localStore()): number {
  if (!store || !listingKey) return 0;
  const k = norm(listingKey);
  const book = read(store);
  const seen = book[k];
  const e = seen ?? { visits: 0, last: now };
  // The first view of a home is always a visit; later views count only after a 30-minute gap.
  if (!seen || now - e.last >= VISIT_GAP_MS) e.visits += 1;
  e.last = now;
  book[k] = e;
  write(store, book);
  return e.visits;
}

export type InterestReason = "repeat_view" | "from_email";

/**
 * Decide whether to offer a save for this home on this view, and claim the offer (it is never
 * made twice for one home on this browser). Call AFTER recordListingVisit for this view.
 */
export function takeInterestOffer(
  listingKey: string,
  search: string,
  store = localStore(),
): InterestReason | null {
  if (!store || !listingKey) return null;
  const k = norm(listingKey);
  const book = read(store);
  const e = book[k];
  if (!e || e.offered) return null;
  let reason: InterestReason | null = null;
  try {
    if (new URLSearchParams(search).get("utm_medium") === "email") reason = "from_email";
  } catch {
    /* malformed query */
  }
  if (!reason && e.visits >= 2) reason = "repeat_view";
  if (!reason) return null;
  e.offered = true;
  book[k] = e;
  write(store, book);
  return reason;
}
