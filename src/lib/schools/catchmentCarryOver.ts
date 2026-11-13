/**
 * Keep a listing's SchoolCatchments through a write that cannot compute it (2026-11).
 *
 * The transformer writes SchoolCatchments only when the catchment index is primed (`[]` is
 * a valid "in no zone" answer, so an un-primed run must not write it). Only the daily sync
 * primes. Every other writer — the listing page's quick-sync (/api/sync), ghost reconcile,
 * media repair, backfill-missing-actives — sends a FULL document with `action: 'upsert'`,
 * and a full upsert REPLACES the document, so the field was deleted on every such write.
 * Measured 2026-11-13: 1,901 of 98,195 active docs had no SchoolCatchments, and a York
 * Region listing lost it between two reads an hour apart. The listing page then showed
 * "no boundaries for this address" on a home with eight zoned schools.
 *
 * Fix: before an un-primed upsert, read the field off the stored documents and put it back
 * on the outgoing ones. A brand-new listing has nothing to carry; the next primed sync or
 * `scripts/admin/backfill-school-catchments.ts` fills it.
 */

/** Parse a Typesense JSONL export of `id,SchoolCatchments` into id → tokens. */
export function parseCatchmentExport(jsonl: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    try {
      const d = JSON.parse(line) as { id?: unknown; SchoolCatchments?: unknown };
      if (typeof d.id === "string" && Array.isArray(d.SchoolCatchments)) {
        out.set(d.id, d.SchoolCatchments.filter((t): t is string => typeof t === "string"));
      }
    } catch {
      /* a bad line is skipped; that doc keeps whatever the writer sends */
    }
  }
  return out;
}

/**
 * Put the stored SchoolCatchments back on each outgoing doc that has none. A doc that
 * already carries the field (a primed run) is never touched. Returns how many it filled.
 */
export function carryCatchments(docs: Array<Record<string, unknown>>, stored: Map<string, string[]>): number {
  let filled = 0;
  for (const d of docs) {
    if ("SchoolCatchments" in d) continue;
    const prev = stored.get(String(d.id));
    if (!prev) continue;
    d.SchoolCatchments = prev;
    filled++;
  }
  return filled;
}
