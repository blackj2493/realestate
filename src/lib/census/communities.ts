/**
 * Community census facts — the neighbourhood hub's "The area" section
 * (/property/{prov}/{city}/{neighbourhood}). Pure: scripts/worker/census/loadCommunities.ts
 * runs it offline and stores the result in census_community_area; the page only reads.
 *
 * A TRREB community (CityRegion) has no census boundary. So each dissemination area (DA)
 * goes to the community that holds most of the listing points in it, and a community's
 * facts pool its DAs. A DA split between communities (no community holds MIN_DA_SHARE of
 * its points) or with too few points (MIN_DA_POINTS) goes to none.
 */

/** Listing points per (city, community) in one DA. `city` is the raw TRREB City value. */
export interface DaCommunityCount {
  dauid: string;
  city: string;
  community: string;
  n: number;
}

export const MIN_DA_POINTS = 3;
export const MIN_DA_SHARE = 0.5;
/** A community with fewer DAs is too small for its own figures. */
export const MIN_COMMUNITY_DAS = 2;

export const communityKey = (city: string, community: string) => `${city}\u0000${community}`;

/** (city, community) key → its DAs. */
export function assignDas(rows: DaCommunityCount[]): Map<string, string[]> {
  const byDa = new Map<string, DaCommunityCount[]>();
  for (const r of rows) {
    const list = byDa.get(r.dauid);
    if (list) list.push(r);
    else byDa.set(r.dauid, [r]);
  }
  const out = new Map<string, string[]>();
  for (const [dauid, list] of byDa) {
    const total = list.reduce((a, r) => a + r.n, 0);
    const top = list.reduce((a, r) => (r.n > a.n ? r : a));
    if (total < MIN_DA_POINTS || top.n / total < MIN_DA_SHARE) continue;
    // A tie at exactly 50% has two "tops"; skip it rather than pick one by row order.
    if (list.some((r) => r !== top && r.n === top.n)) continue;
    const k = communityKey(top.city, top.community);
    const das = out.get(k);
    if (das) das.push(dauid);
    else out.set(k, [dauid]);
  }
  for (const [k, das] of out) {
    if (das.length < MIN_COMMUNITY_DAS) out.delete(k);
    else das.sort();
  }
  return out;
}

/** The most common value; ties go to the first one seen. */
export function mode<T>(values: T[]): T | null {
  const n = new Map<T, number>();
  let best: T | null = null;
  let bestN = 0;
  for (const v of values) {
    const c = (n.get(v) ?? 0) + 1;
    n.set(v, c);
    if (c > bestN) {
      best = v;
      bestN = c;
    }
  }
  return best;
}
