/**
 * Purge de-listed comps whose property has since CLOSED.
 *
 * WHY (see src/lib/sold/supersededDelisted.ts for the full incident write-up):
 * `pruneOldDelisted` drops de-listed docs on AGE alone, so a terminate-then-relist
 * resale leaves the ORIGINAL key lit on the terminal's De-listed layer for up to 90
 * days after the property sold under its new MLS#. The detail page already resolves
 * that case correctly (getListingDetail's relist reconciliation promotes it to SOLD),
 * so the two surfaces contradict each other — the 210 Charlton Ave E report.
 * Measured 2026-08-03: 7,103 of 59,730 For-Sale de-listed pins (11.9%) had closed.
 *
 * THREE ENTRY POINTS, because the miss can happen in either feed order:
 *
 *  1. purgeSupersededForCloses  — called from importSoldBatch, so EVERY writer of a
 *     close (Query B, ghostReconcile, both sold reconcilers, the backfill) purges the
 *     de-listed doc it just invalidated. Covers the normal order: de-list, then sale.
 *     Only SALES retire a pin — a failed sale campaign that later leased keeps its pin
 *     (the owner still owns it and still wanted to sell). See SUPERSEDING_DEAL_TYPES.
 *
 *  2. partitionSupersededDelisted — called from delistedIndexer before indexing, for
 *     the REVERSE order: a 12-month `backfill`, or TRREB re-touching an old terminated
 *     record, replays a de-list whose property already sold. Without this, Query C
 *     would re-insert the exact doc step 1 deleted.
 *
 *  3. sweep (CLI)               — whole-window join, for the one-time cleanup of the
 *     7,103 already-stale docs and as a nightly backstop.
 *
 * Every path is BEST-EFFORT: a Typesense failure here must never break a sync. The
 * worst case is the status quo (a stale pin), which the nightly sweep then clears.
 *
 * The Supabase `raw_vow_delisted` archive is deliberately NOT touched — it stays the
 * truth source for the de-list event, and listingStatus/the detail page still read it
 * to render the campaign's own history. Only the map/comp doc goes.
 *
 * CLI:
 *   npx tsx scripts/worker/purgeSupersededDelisted.ts sweep            (dry run — reports only)
 *   npx tsx scripts/worker/purgeSupersededDelisted.ts sweep --apply    (delete)
 *   npx tsx scripts/worker/purgeSupersededDelisted.ts sweep --apply --limit 500
 */
import 'dotenv/config';
import type { Client } from 'typesense';
import {
  SOLD_LISTINGS_COLLECTION,
  type SoldListingDocument,
} from '../../src/lib/typesense/soldListingsSchema';
import { DELISTED_DEAL_TYPES, isDelistedDealType } from '../../src/lib/sold/dealType';
import {
  SUPERSEDING_DEAL_TYPES,
  isSupersedingDealType,
  selectSupersededDelisted,
  type CompEvent,
  type SupersededMatch,
} from '../../src/lib/sold/supersededDelisted';
import { buildIdDeleteFilters } from './staleSearchDocs';

/** Addresses per `UnparsedAddress:=[...]` filter. ~45 chars each — keeps the
 *  query string well inside Typesense's limit while minimising round trips. */
const ADDRESS_CHUNK = 50;
/** Typesense caps per_page at 250. */
const PAGE_SIZE = 250;
const DELISTED_FILTER = `DealType:=[${DELISTED_DEAL_TYPES.join(',')}]`;
/** SOLD only — a lease close deliberately does NOT retire a pin (see SUPERSEDING_DEAL_TYPES). */
const CLOSE_FILTER = `DealType:=[${SUPERSEDING_DEAL_TYPES.join(',')}]`;
const FIELDS = 'id,DealType,UnparsedAddress,PurchaseContractDate';

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Distinct, non-empty addresses from a doc batch (verbatim — the filter below is
 *  case-insensitive, so no normalisation is needed or wanted here). */
export function distinctAddresses(docs: Array<{ UnparsedAddress?: string }>): string[] {
  const seen = new Set<string>();
  for (const d of docs) {
    const a = (d.UnparsedAddress ?? '').trim();
    if (a) seen.add(a);
  }
  return [...seen];
}

/**
 * Every doc at these exact addresses matching `dealFilter`.
 *
 * `UnparsedAddress:=` is a case-insensitive WHOLE-FIELD match (probe-verified
 * 2026-08-03): unit-precise ("455 Charlton Avenue E 602" never matches unit 301),
 * order-sensitive, and a token subset matches nothing. That precision is what makes
 * an address join safe here.
 */
async function fetchByAddresses(
  client: Client,
  addresses: string[],
  dealFilter: string
): Promise<CompEvent[]> {
  const found: CompEvent[] = [];
  for (const group of chunk(addresses, ADDRESS_CHUNK)) {
    const list = group.map((a) => `\`${a.replace(/`/g, '')}\``).join(',');
    const filter = `UnparsedAddress:=[${list}] && ${dealFilter}`;
    for (let page = 1; ; page++) {
      const res: any = await client
        .collections(SOLD_LISTINGS_COLLECTION)
        .documents()
        .search({ q: '*', filter_by: filter, include_fields: FIELDS, per_page: PAGE_SIZE, page } as any);
      const hits = res?.hits ?? [];
      for (const h of hits) found.push(h.document as CompEvent);
      // Typesense caps deep paging; `found` here is the TOTAL match count.
      if (hits.length < PAGE_SIZE || page * PAGE_SIZE >= (res?.found ?? 0)) break;
    }
  }
  return found;
}

/** Chunked delete-by-id. Returns how many docs Typesense reported deleting. */
async function deleteDocs(client: Client, ids: string[]): Promise<number> {
  let deleted = 0;
  for (const filter of buildIdDeleteFilters(ids)) {
    const res: any = await client
      .collections(SOLD_LISTINGS_COLLECTION)
      .documents()
      .delete({ filter_by: filter } as any);
    deleted += res?.num_deleted ?? 0;
  }
  return deleted;
}

/**
 * Read-only half of ENTRY 1: which de-listed comps does this batch of closes
 * invalidate? Separated so the wiring is testable and dry-runnable without deleting.
 */
export async function detectSupersededForCloses(
  client: Client,
  docs: SoldListingDocument[]
): Promise<SupersededMatch[]> {
  const closes = docs.filter((d) => isSupersedingDealType(d.DealType)) as CompEvent[];
  const addresses = distinctAddresses(closes);
  if (addresses.length === 0) return [];

  const delisted = await fetchByAddresses(client, addresses, DELISTED_FILTER);
  if (delisted.length === 0) return [];

  return selectSupersededDelisted(delisted, closes);
}

/**
 * ENTRY 1 — after a batch of CLOSES is indexed, drop the de-listed comps they
 * invalidate. A no-op for batches with no closes (delistedIndexer reuses
 * importSoldBatch to write de-listed docs, and must not trigger a purge).
 *
 * Best-effort: never throws.
 */
export async function purgeSupersededForCloses(
  client: Client,
  docs: SoldListingDocument[]
): Promise<number> {
  try {
    const matches = await detectSupersededForCloses(client, docs);
    if (matches.length === 0) return 0;

    const deleted = await deleteDocs(client, matches.map((m) => m.delistedId));
    if (deleted > 0) {
      console.log(
        `   🧹 Purged ${deleted} de-listed comp(s) superseded by this batch's closes ` +
          `(e.g. ${matches[0].delistedId} → ${matches[0].closeId} ${day(matches[0].closedAt)})`
      );
    }
    return deleted;
  } catch (err: any) {
    console.warn(`   ⚠️  Superseded-de-listed purge failed (non-fatal): ${err?.message || err}`);
    return 0;
  }
}

export interface DelistedPartition {
  /** Safe to index — the property has not closed since this de-list. */
  keep: SoldListingDocument[];
  /** Already superseded; must not be (re-)indexed. */
  superseded: SoldListingDocument[];
}

/**
 * ENTRY 2 — split a de-listed batch before indexing so a replayed/late de-list can
 * never resurrect a pin for a property that has already closed.
 *
 * Best-effort: on any failure everything is kept (status quo), never dropped.
 */
export async function partitionSupersededDelisted(
  client: Client,
  docs: SoldListingDocument[]
): Promise<DelistedPartition> {
  try {
    const delisted = docs.filter((d) => isDelistedDealType(d.DealType));
    const addresses = distinctAddresses(delisted);
    if (addresses.length === 0) return { keep: docs, superseded: [] };

    const closes = await fetchByAddresses(client, addresses, CLOSE_FILTER);
    if (closes.length === 0) return { keep: docs, superseded: [] };

    const supersededIds = new Set(
      selectSupersededDelisted(delisted as CompEvent[], closes).map((m) => m.delistedId)
    );
    if (supersededIds.size === 0) return { keep: docs, superseded: [] };

    return {
      keep: docs.filter((d) => !supersededIds.has(d.id)),
      superseded: docs.filter((d) => supersededIds.has(d.id)),
    };
  } catch (err: any) {
    console.warn(`   ⚠️  Superseded-de-listed check failed (non-fatal): ${err?.message || err}`);
    return { keep: docs, superseded: [] };
  }
}

/**
 * Stream every doc matching a filter. `export` returns the WHOLE matching set as
 * JSONL in one response — no deep-paging cap, which a 60k+ scan would otherwise hit.
 */
async function exportAll(client: Client, filter: string): Promise<CompEvent[]> {
  const jsonl = (await client
    .collections(SOLD_LISTINGS_COLLECTION)
    .documents()
    .export({ filter_by: filter, include_fields: FIELDS } as any)) as unknown as string;
  return jsonl
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as CompEvent);
}

export interface SweepResult {
  delistedScanned: number;
  closesScanned: number;
  superseded: number;
  deleted: number;
  matches: SupersededMatch[];
}

/**
 * ENTRY 3 — whole-collection join. Catches anything the two inline paths missed
 * (including de-lists whose close landed while the purge was failing) and does the
 * one-time cleanup of the existing backlog.
 */
export async function sweepSupersededDelisted(
  client: Client,
  opts: { apply: boolean; limit?: number } = { apply: false }
): Promise<SweepResult> {
  const [delisted, closes] = await Promise.all([
    exportAll(client, DELISTED_FILTER),
    exportAll(client, CLOSE_FILTER),
  ]);
  let matches = selectSupersededDelisted(delisted, closes);
  if (opts.limit && opts.limit > 0) matches = matches.slice(0, opts.limit);

  const result: SweepResult = {
    delistedScanned: delisted.length,
    closesScanned: closes.length,
    superseded: matches.length,
    deleted: 0,
    matches,
  };
  if (opts.apply && matches.length > 0) {
    result.deleted = await deleteDocs(client, matches.map((m) => m.delistedId));
  }
  return result;
}

// ── CLI ──────────────────────────────────────────────────────────────────────
const invokedDirectly =
  typeof process !== 'undefined' &&
  !!process.argv[1] &&
  /purgeSupersededDelisted\.(ts|js)$/.test(process.argv[1]);

if (invokedDirectly) {
  (async () => {
    const argv = process.argv.slice(2);
    if (argv[0] !== 'sweep') {
      console.error('Usage: purgeSupersededDelisted.ts sweep [--apply] [--limit N]');
      process.exit(1);
    }
    const apply = argv.includes('--apply');
    const limitArg = argv.find((a) => a.startsWith('--limit'));
    const limit = limitArg
      ? Number(limitArg.includes('=') ? limitArg.split('=')[1] : argv[argv.indexOf(limitArg) + 1])
      : undefined;

    // Imported lazily so this module stays free of the soldIndexer import cycle
    // (soldIndexer → purgeSupersededDelisted → soldIndexer).
    const { getSoldAdminClient } = await import('./soldIndexer');
    const client = getSoldAdminClient();

    console.log(`\n🧹 Superseded de-listed sweep — ${apply ? 'APPLY' : 'DRY RUN'}`);
    const res = await sweepSupersededDelisted(client, { apply, limit });
    console.log(`   scanned ${res.delistedScanned} de-listed · ${res.closesScanned} closes`);
    console.log(`   superseded: ${res.superseded}`);
    for (const m of res.matches.slice(0, 20)) {
      console.log(
        `     ${m.delistedId} de-listed ${day(m.delistedAt)} → ${m.closeId} closed ${day(m.closedAt)} | ${m.address}`
      );
    }
    if (res.matches.length > 20) console.log(`     …and ${res.matches.length - 20} more`);
    console.log(apply ? `   ✅ Deleted ${res.deleted}` : '   (dry run — re-run with --apply to delete)');
    process.exit(0);
  })().catch((err) => {
    console.error('❌ purgeSupersededDelisted failed:', err?.message || err);
    process.exit(1);
  });
}
