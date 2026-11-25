/**
 * Per-instance TTL memo for PUBLIC reads on crawler-heavy pages (the /address tree).
 *
 * WHY. On 2026-11-24 bulk AI crawlers rendered ~213K anonymous /address pages in 12 hours;
 * each render ran 6-8 Typesense searches and pinned the cluster's burst CPU. Most of those
 * searches repeat across renders: the city facet is one query for every page, and pages
 * near each other ask for the same nearby homes.
 *
 * WHY NOT unstable_cache. The Vercel Data Cache bills per write; a crawl over unique
 * addresses writes once per page and rarely reads back. This memo lives in the function
 * instance's memory (Fluid compute keeps instances warm across many requests), costs
 * nothing, and also joins concurrent identical calls into one search (`inflight`).
 *
 * ONLY FOR DATA THAT IS THE SAME FOR EVERY VISITOR. Never memo a VOW (gated) read.
 * A rejected promise is not kept, so a Typesense error is retried on the next call.
 */
export interface MemoOptions {
  ttlMs: number;
  /** Most entries kept; the oldest is dropped first. */
  max: number;
  /** Keep a resolved value only when this returns true (e.g. not a fail-soft null or []
   *  that a caught Typesense error returns). Default: keep every value. */
  keep?: (value: unknown) => boolean;
}

export function ttlMemo<A extends unknown[], R>(fn: (...args: A) => Promise<R>, key: (...args: A) => string, opts: MemoOptions) {
  const store = new Map<string, { at: number; value: Promise<R> }>();
  const memo = (...args: A): Promise<R> => {
    const k = key(...args);
    const now = Date.now();
    const hit = store.get(k);
    if (hit && now - hit.at < opts.ttlMs) return hit.value;
    if (hit) store.delete(k);
    const value = fn(...args);
    store.set(k, { at: now, value });
    const drop = () => {
      if (store.get(k)?.value === value) store.delete(k);
    };
    value.then((v) => {
      if (opts.keep && !opts.keep(v)) drop();
    }, drop);
    while (store.size > opts.max) store.delete(store.keys().next().value as string);
    return value;
  };
  memo.clear = () => store.clear();
  memo.size = () => store.size;
  return memo;
}
