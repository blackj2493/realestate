/**
 * Recompute `isDistressed` across the active Typesense index under the current rule.
 *
 * WHY THIS EXISTS
 * ───────────────
 * `isDistressed` is written by the ETL (scripts/worker/transformer.ts → calculateDerivedMetrics)
 * at index time. The scheduled sync only re-transforms the `ModificationTimestamp gt cursor`
 * DELTA (Query A, ingester.ts), so a listing that is stable in the feed is never re-transformed
 * and keeps whatever flag it was indexed with. Changing the RULE therefore does not change the
 * INDEX: without this job the collection splits in two — freshly-touched listings on the new
 * rule, everything else frozen on the old one. That split-brain is the failure mode this
 * codebase keeps hitting, so the rule change and this backfill ship together.
 *
 * The rule itself lives in src/lib/listings/distressSignals.ts and is imported, never copied —
 * see that file for what counts as distress and, more importantly, what deliberately doesn't.
 *
 * WHY IT NEEDS NO FEED PULL
 * `PublicRemarks` is stored in the `properties` collection (returned by search, just not
 * queryable), and the rule is a pure function of that one field. So the job reads remarks from
 * the index, recomputes, and patches the boolean back — no ProptX/VOW call, no re-ingest, no
 * dependency on the vault.
 *
 * SAFETY
 *  • Typesense `action:'update'` (partial) touching ONLY `isDistressed`; every other field on
 *    the document is left byte-identical.
 *  • Idempotent — re-running writes nothing once converged, because it only emits documents
 *    whose stored flag disagrees with the recomputed one.
 *  • Reversible — the flag is DERIVED. Reverting the rule and re-running restores the old
 *    values exactly.
 *  • Dry-run by default. Nothing is written without --apply.
 *
 * Usage:
 *   npx tsx scripts/admin/recompute-distress-flag.ts                  # dry-run: counts + samples
 *   npx tsx scripts/admin/recompute-distress-flag.ts --apply          # patch every drifted doc
 *   npx tsx scripts/admin/recompute-distress-flag.ts --limit=5000     # bound the scan
 *   npx tsx scripts/admin/recompute-distress-flag.ts --samples=25     # show more examples
 * Env: TYPESENSE_ADMIN_API_KEY (export + partial update both need it).
 */

import 'dotenv/config';
import { detectDistress } from '@/lib/listings/distressSignals';

// Typesense Cloud host — hardcoded, in lockstep with client.ts + sync.ts (no host env var).
const TYPESENSE_HOST = '9uyapwh6e5qmvl34p-1.a1.typesense.net';
const COLLECTION = 'properties';
const TS_CHUNK = 500;

interface ScanRow {
  id: string;
  ListingKey?: string;
  UnparsedAddress?: string;
  PublicRemarks?: string;
  isDistressed?: boolean;
}

interface Drift {
  id: string;
  key: string;
  address: string;
  from: boolean;
  to: boolean;
  matched: string[];
}

function apiKey(): string {
  const key = process.env.TYPESENSE_ADMIN_API_KEY;
  if (!key) {
    console.error('❌ TYPESENSE_ADMIN_API_KEY is not set — export and partial update both require it.');
    process.exit(1);
  }
  return key;
}

/**
 * Stream every document in the collection via the export endpoint (JSONL).
 *
 * Export, not paged search: deep pagination caps out well below the ~74k documents here, and
 * silently returning a prefix of the collection would look exactly like a converged backfill.
 */
async function* scan(limit: number | null): AsyncGenerator<ScanRow> {
  const params = new URLSearchParams({
    include_fields: 'id,ListingKey,UnparsedAddress,PublicRemarks,isDistressed',
  });
  const res = await fetch(`https://${TYPESENSE_HOST}/collections/${COLLECTION}/documents/export?${params}`, {
    headers: { 'X-TYPESENSE-API-KEY': apiKey() },
  });
  if (!res.ok || !res.body) {
    console.error(`❌ Export failed: HTTP ${res.status} ${await res.text().catch(() => '')}`);
    process.exit(1);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let yielded = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let nl: number;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      try {
        yield JSON.parse(line) as ScanRow;
      } catch {
        continue; // a truncated line can't be recovered; the next one is intact
      }
      if (limit && ++yielded >= limit) {
        await reader.cancel();
        return;
      }
    }
  }
  const tail = buffer.trim();
  if (tail && (!limit || yielded < limit)) {
    try {
      yield JSON.parse(tail) as ScanRow;
    } catch {
      /* ignore a partial trailing line */
    }
  }
}

async function pushChunk(rows: Drift[]): Promise<{ updated: number; failed: number }> {
  const body = rows.map((r) => JSON.stringify({ id: r.id, isDistressed: r.to })).join('\n');
  const res = await fetch(
    `https://${TYPESENSE_HOST}/collections/${COLLECTION}/documents/import?action=update`,
    {
      method: 'POST',
      headers: { 'X-TYPESENSE-API-KEY': apiKey(), 'Content-Type': 'text/plain' },
      body,
    }
  );
  const text = await res.text();
  let updated = 0;
  let failed = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      if (JSON.parse(line).success) updated++;
      else failed++;
    } catch {
      failed++;
    }
  }
  return { updated, failed };
}

async function main() {
  const apply = process.argv.includes('--apply');
  const limitArg = process.argv.find((a) => a.startsWith('--limit='));
  const sampleArg = process.argv.find((a) => a.startsWith('--samples='));
  const limit = limitArg ? Number(limitArg.split('=')[1]) : null;
  const sampleCount = sampleArg ? Number(sampleArg.split('=')[1]) : 10;

  console.log('\n🏷️  Recompute isDistressed');
  console.log(`  ${apply ? 'APPLY' : 'DRY-RUN'}${limit ? ` · limit ${limit}` : ''}\n`);

  let scanned = 0;
  let storedTrue = 0;
  let computedTrue = 0;
  let forcedSale = 0;
  let needsWork = 0;
  let noRemarks = 0;
  const clearing: Drift[] = []; // true → false (badge removed)
  const setting: Drift[] = []; // false → true (badge added)

  for await (const row of scan(limit)) {
    scanned++;
    if (!row.PublicRemarks || !row.PublicRemarks.trim()) noRemarks++;

    const stored = Boolean(row.isDistressed);
    const sig = detectDistress(row.PublicRemarks);
    if (stored) storedTrue++;
    if (sig.isDistressed) computedTrue++;
    if (sig.forcedSale) forcedSale++;
    if (sig.needsWork) needsWork++;

    if (stored !== sig.isDistressed) {
      const drift: Drift = {
        id: row.id,
        key: row.ListingKey ?? row.id,
        address: row.UnparsedAddress ?? '(no address)',
        from: stored,
        to: sig.isDistressed,
        matched: sig.matched,
      };
      (stored ? clearing : setting).push(drift);
    }

    if (scanned % 20_000 === 0) console.log(`   … scanned ${scanned.toLocaleString()}`);
  }

  const pct = (n: number) => (scanned ? `${((n / scanned) * 100).toFixed(2)}%` : '-');
  console.log(`\n📊 Scanned ${scanned.toLocaleString()} documents`);
  console.log(`   no public remarks:        ${noRemarks.toLocaleString()} (${pct(noRemarks)})`);
  console.log('');
  console.log(`   stored  isDistressed=true: ${storedTrue.toLocaleString()} (${pct(storedTrue)})   ← today`);
  console.log(`   NEW     isDistressed=true: ${computedTrue.toLocaleString()} (${pct(computedTrue)})   ← after this job`);
  console.log('');
  console.log(`      of which forced sale:   ${forcedSale.toLocaleString()} (${pct(forcedSale)})`);
  console.log(`      of which needs work:    ${needsWork.toLocaleString()} (${pct(needsWork)})`);
  console.log('');
  console.log(`   badge REMOVED from:        ${clearing.length.toLocaleString()}`);
  console.log(`   badge ADDED to:            ${setting.length.toLocaleString()}`);

  const show = (title: string, rows: Drift[]) => {
    if (rows.length === 0) return;
    console.log(`\n   ${title} (first ${Math.min(sampleCount, rows.length)}):`);
    for (const r of rows.slice(0, sampleCount)) {
      const why = r.matched.length ? `  [${r.matched.join(', ')}]` : '';
      console.log(`      ${r.key.padEnd(12)} ${r.address.slice(0, 52).padEnd(52)}${why}`);
    }
  };
  show('Sample — badge removed', clearing);
  show('Sample — badge added', setting);

  const drifted = [...clearing, ...setting];
  if (!apply) {
    console.log(`\nDRY-RUN — re-run with --apply to patch ${drifted.length.toLocaleString()} document(s).`);
    return;
  }
  if (drifted.length === 0) {
    console.log('\n✅ Already converged — nothing to write.');
    return;
  }

  console.log(`\n📤 Patching isDistressed on ${drifted.length.toLocaleString()} document(s)…`);
  let updated = 0;
  let failed = 0;
  for (let i = 0; i < drifted.length; i += TS_CHUNK) {
    const chunk = drifted.slice(i, i + TS_CHUNK);
    const r = await pushChunk(chunk);
    updated += r.updated;
    failed += r.failed;
    console.log(`   … ${Math.min(i + TS_CHUNK, drifted.length)}/${drifted.length} (updated ${updated}, failed ${failed})`);
  }
  console.log(`\n✅ Typesense: ${updated.toLocaleString()} updated, ${failed.toLocaleString()} failed.`);
}

main().catch((err) => {
  console.error('❌ Fatal:', err);
  process.exit(1);
});
