/**
 * Description search — add SearchRemarks + description_signals to the live `properties`
 * collection and fill them for every existing document.
 *
 * The nightly sync writes both fields for listings it re-transforms (transformer.ts →
 * descriptionSearchFields), but it only touches the day's ModificationTimestamp delta. This
 * script does the rest of the index, and is the step to re-run whenever a signal's
 * patterns change (see the header of src/lib/listings/descriptionSignals.ts).
 *
 * Typesense ONLY — PublicRemarks and TransactionType are already stored on every document,
 * so there are zero Supabase reads (IO budget).
 *
 *   1. DRY-RUN (default): exports id/PublicRemarks/TransactionType, computes both fields,
 *      and prints what the write would add — the text volume that drives the RAM increase,
 *      and how many listings each signal tags. Writes nothing.
 *   2. --apply: alters the collection to declare any missing field (definitions pulled from
 *      typesenseSchema — declare there first), then imports the computed values with
 *      action:'update' in batches, then verifies both fields are queryable.
 *
 * RAM. Indexing SearchRemarks builds an inverted index over the for-sale descriptions.
 * Run --apply in the daytime (the nightly sync writes at 03:00 UTC), and watch Memory Usage
 * on the Typesense Cloud dashboard while it runs. Typesense refuses WRITES once RAM + swap
 * reach the cluster total — the nightly sync is what fails first, not searches.
 *
 * Usage:
 *   npx tsx scripts/admin/backfillDescriptionSearch.ts           # dry-run
 *   npx tsx scripts/admin/backfillDescriptionSearch.ts --apply   # alter + backfill
 */
import 'dotenv/config';
import Typesense from 'typesense';
import { typesenseSchema } from '@/lib/typesense/typesenseSchema';
import { DESCRIPTION_SIGNALS, descriptionSearchFields } from '@/lib/listings/descriptionSignals';

const APPLY = process.argv.includes('--apply');
const TYPESENSE_HOST = '9uyapwh6e5qmvl34p-1.a1.typesense.net';
const COLLECTION = 'properties';
const KEY = process.env.TYPESENSE_ADMIN_API_KEY || '';
const FIELDS = ['SearchRemarks', 'description_signals'] as const;
/** Smaller than the other backfills' 2000: each update line carries ~1 KB of text. */
const CHUNK = 1000;

const ts = new Typesense.Client({
  nodes: [{ host: TYPESENSE_HOST, port: 443, protocol: 'https' }],
  apiKey: KEY,
  connectionTimeoutSeconds: 300,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = any;

async function missingFields(): Promise<string[]> {
  const coll: AnyObj = await ts.collections(COLLECTION).retrieve();
  const present = new Set((coll.fields || []).map((f: AnyObj) => f.name));
  return FIELDS.filter((f) => !present.has(f));
}

async function alterCollection(missing: string[]) {
  if (!missing.length) {
    console.log('Both fields already declared on the live collection.');
    return;
  }
  const defs = missing.map((name) => {
    const def = (typesenseSchema.fields as AnyObj[]).find((f) => f.name === name);
    if (!def) throw new Error(`${name} not found in typesenseSchema.fields — declare it there first.`);
    return def;
  });
  console.log(`Fields to add:\n  ${defs.map((d) => JSON.stringify(d)).join('\n  ')}`);
  if (!APPLY) {
    console.log('  (dry-run — collection not altered)');
    return;
  }
  await ts.collections(COLLECTION).update({ fields: defs } as AnyObj);
  console.log('  ✅ Collection altered.');
}

interface Computed {
  lines: string[];
  docs: number;
  saleDocs: number;
  textBytes: number;
  perSignal: Map<string, number>;
}

async function computeUpdates(): Promise<Computed> {
  const raw = (await ts
    .collections(COLLECTION)
    .documents()
    .export({ include_fields: 'id,PublicRemarks,TransactionType' })) as unknown as string;
  const out: Computed = { lines: [], docs: 0, saleDocs: 0, textBytes: 0, perSignal: new Map() };
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const doc = JSON.parse(line) as AnyObj;
    if (!doc.id) continue;
    const fields = descriptionSearchFields(doc.PublicRemarks, doc.TransactionType);
    out.docs += 1;
    if (fields.SearchRemarks) {
      out.saleDocs += 1;
      out.textBytes += Buffer.byteLength(fields.SearchRemarks, 'utf8');
    }
    for (const id of fields.description_signals) out.perSignal.set(id, (out.perSignal.get(id) ?? 0) + 1);
    out.lines.push(JSON.stringify({ id: doc.id, ...fields }));
  }
  return out;
}

function report(c: Computed) {
  const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;
  console.log(`\nDocuments exported:          ${c.docs.toLocaleString()}`);
  console.log(`For-sale docs with text:     ${c.saleDocs.toLocaleString()}`);
  console.log(`Description text to index:   ${mb(c.textBytes)}`);
  console.log(
    `Rough RAM increase:          ${mb(c.textBytes * 2)} – ${mb(c.textBytes * 3)}` +
      '  (Typesense guidance: 2–3× the indexed field size)'
  );
  console.log('\nListings each signal tags:');
  for (const s of DESCRIPTION_SIGNALS) {
    const n = c.perSignal.get(s.id) ?? 0;
    const pct = c.docs ? ((n / c.docs) * 100).toFixed(1) : '0.0';
    console.log(`  ${s.label.padEnd(28)} ${n.toLocaleString().padStart(7)}  (${pct}%)`);
  }
  console.log('\nA signal on more than ~15% of listings is probably matching too loosely — read a sample before shipping it.');
}

async function writeUpdates(lines: string[]) {
  let done = 0;
  let failed = 0;
  for (let i = 0; i < lines.length; i += CHUNK) {
    const batch = lines.slice(i, i + CHUNK);
    const res = (await ts
      .collections(COLLECTION)
      .documents()
      .import(batch.join('\n'), { action: 'update' })) as unknown as Array<{ success: boolean; error?: string }>;
    const bad = Array.isArray(res) ? res.filter((r) => !r.success) : [];
    failed += bad.length;
    if (bad.length) console.log(`   ⚠️  ${bad.length} failed in batch ${i / CHUNK + 1}: ${bad[0]?.error ?? 'unknown'}`);
    done += batch.length;
    console.log(`   …updated ${done.toLocaleString()}/${lines.length.toLocaleString()}`);
  }
  console.log(failed ? `   ⚠️  ${failed} documents failed.` : '   ✅ Backfill complete.');
}

/** Prove both fields answer queries: -1 means Typesense refused (HTTP 400). */
async function verify() {
  const count = async (params: AnyObj) => {
    try {
      const r: AnyObj = await ts.collections(COLLECTION).documents().search({ per_page: 0, ...params });
      return r.found ?? 0;
    } catch (e: AnyObj) {
      console.log(`   query failed: ${e?.message || e}`);
      return -1;
    }
  };
  const signal = await count({ q: '*', query_by: 'City', filter_by: 'description_signals:=separate_entrance' });
  const text = await count({ q: 'entrance', query_by: 'SearchRemarks', prefix: false });
  console.log(`\nVerify: description_signals:=separate_entrance → ${signal.toLocaleString()}`);
  console.log(`Verify: text search "entrance" in SearchRemarks → ${text.toLocaleString()}`);
}

async function main() {
  console.log(`\n🔎 Description search backfill  [${APPLY ? 'APPLY' : 'DRY-RUN'}]`);
  console.log('='.repeat(56));
  if (!KEY) {
    console.error('TYPESENSE_ADMIN_API_KEY is not set.');
    process.exit(1);
  }
  await alterCollection(await missingFields());
  const computed = await computeUpdates();
  report(computed);
  if (!APPLY) {
    console.log('\nDry-run only. Re-run with --apply to write.');
    return;
  }
  await writeUpdates(computed.lines);
  await verify();
  console.log('\nNow check Memory Usage on the Typesense Cloud dashboard.');
}

main().catch((e) => {
  console.error('❌', e instanceof Error ? e.message : e);
  process.exit(1);
});
