/**
 * Recently-viewed listings (localStorage). Anonymous app — no server identity.
 * Records a compact snapshot on the listing detail page; the dashboard reads it back.
 */

const KEY = 'pp_recently_viewed';
const CAP = 12;

export interface RecentListing {
  id: string;
  address: string;
  price: number;
  thumb?: string;
  city?: string;
  /**
   * Listing brokerage (ListOfficeName). TRREB §6.3(c) mandates the brokerage on
   * EVERY displayed listing — including recently-viewed cards — at the same
   * weight as other detail lines. Captured in the snapshot at record-view time
   * (recordView), so existing entries saved before this field shipped simply
   * omit it and the card renders the line conditionally.
   */
  brokerage?: string;
  viewedAt: number;
}

export function recordView(item: Omit<RecentListing, 'viewedAt'>): void {
  if (typeof window === 'undefined' || !item.id) return;
  try {
    const list = getRecentlyViewed().filter((r) => r.id !== item.id);
    list.unshift({ ...item, viewedAt: Date.now() });
    window.localStorage.setItem(KEY, JSON.stringify(list.slice(0, CAP)));
  } catch {
    /* ignore quota / serialization errors */
  }
}

export function getRecentlyViewed(): RecentListing[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as RecentListing[]) : [];
  } catch {
    return [];
  }
}
