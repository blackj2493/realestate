/**
 * Backfill LEASE-track rental DOM (LeaseTrueDom) for active For-Lease listings.
 *
 * WHY THIS EXISTS
 * ───────────────
 * The "For Rent" dashboard boards (Freshest / Longest-Listed Rentals) sort on the new
 * `LeaseTrueDom` Typesense field (migration 107). sync.ts writes it going forward, but
 * — exactly like the sale-side `true_dom` — it only touches the `ModificationTimestamp gt
 * cursor` DELTA each night. A stable For-Lease listing (old ModificationTimestamp) never
 * re-enters the delta, so its LeaseTrueDom would freeze at 0 as it ages. This is the
 * lease twin of the sale `refloor-active-true-dom.ts` coverage gap.
 *
 * This job floors LeaseTrueDom to the listing's naive age (days since its EntryTimestamp)
 * for every active For-Lease doc, so the rental DOM boards are correct on day one instead
 * of trickling in over the delta.
 *
 * WHY TYPESENSE-DRIVEN (not pure SQL like refloor)
 * ────────────────────────────────────────────────
 * `listings` has NO flat transaction_type column, and identifying For-Lease rows in SQL
 * would mean either a full_payload->>'TransactionType' detoast (the statement-timeout risk
 * refloor exists to avoid) or a list_price proxy (the proxy-threshold anti-pattern). The
 * `properties` index already carries the indexed `TransactionType` facet + `EntryTimestamp`,
 * so we page it to find the lease docs, then persist by EXACT listing_key (no scan/detoast).
 *
 * WHAT IT WRITES
 *  • Typesense `properties`: partial action:'update' of LeaseTrueDom (the board reads this).
 *  • Vault (unless --skip-vault): listings.lease_true_dom flat column AND full_payload.lease_true_dom,
 *    keyed by listing_key in batches, so a later reindex-from-vault won't revert the index.
 *
 * NOT handled here: LeaseTotalPriceDrop (the "Biggest Rent Reductions" board). It is a
 * stitched campaign metric with no naive-age proxy; it fills in via the forward sync as the
 * property_campaign_history ledger re-warms (24h TTL) and sync.ts writes it. This backfill
 * deliberately does not fabricate a rent drop.
 *
 * SAFETY
 *  • LeaseTrueDom is DERIVED + monotonic here (GREATEST only ever raises it to the real age).
 *  • Gated to active For-Lease docs by the indexed facet; no sale/sold row is touched.
 *  • Typesense action:'update' is partial; a doc absent from the index fails just its line
 *    (counted via err.importResults, never fatal) — same lesson as refloor.
 *
 * Usage:
 *   npx tsx scripts/admin/backfill-lease-metrics.ts                 # dry-run (counts only)
 *   npx tsx scripts/admin/backfill-lease-metrics.ts --apply         # backfill every drifted lease doc
 *   npx tsx scripts/admin/backfill-lease-metrics.ts --apply --min-drift=3
 *   npx tsx scripts/admin/backfill-lease-metrics.ts --apply --limit=5000
 *   npx tsx scripts/admin/backfill-lease-metrics.ts --apply --skip-vault   # Typesense only
 * Env: TYPESENSE_ADMIN_API_KEY (required); DATABASE_URL (Session-pooler; required unless --skip-vault).
 */
import 'dotenv/config';
import { Client as PgClient } from 'pg';
import Typesense, { Client } from 'typesense';

// Typesense Cloud host — hardcoded, in lockstep with client.ts + sync.ts (no host env var).
const TYPESENSE_HOST = '9uyapwh6e5qmvl34p-1.a1.typesense.net';
const TYPESENSE_PORT = 443;
const PROPERTIES_COLLECTION = 'properties';
const DAY_MS = 86_400_000;
const PAGE = 250;          // Typesense page size for the lease-doc scan
const TS_CHUNK = 500;      // partial-update batch
const VAULT_CHUNK = 1000;  // keyed UPDATE batch

interface Candidate { key: string; age: number; }

function argVal(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : null;
}

function tsClient(): Client {
  const key = process.env.TYPESENSE_ADMIN_API_KEY;
  if (!key) throw new Error('TYPESENSE_ADMIN_API_KEY is not set');
  return new Typesense.Client({
    nodes: [{ host: TYPESENSE_HOST, port: TYPESENSE_PORT, protocol: 'https' }],
    apiKey: key,
    connectionTimeoutSeconds: 30,
  });
}

/** Page the active For-Lease docs and collect those whose naive age has drifted ≥ minDrift
 *  above the stored LeaseTrueDom. EntryTimestamp is epoch ms (transformer.ts). */
async function findCandidates(ts: Client, nowMs: number, minDrift: number, limit: number): Promise<Candidate[]> {
  const out: Candidate[] = [];
  let page = 1;
  for (;;) {
    const res = await ts
      .collections(PROPERTIES_COLLECTION)
      .documents()
      .search({
        q: '*',
        query_by: 'City', // syntactically required for q:'*'
        filter_by: 'TransactionType:=`For Lease`',
        include_fields: 'id,EntryTimestamp,LeaseTrueDom',
        sort_by: 'EntryTimestamp:asc',
        per_page: PAGE,
        page,
      });
    const hits = res.hits ?? [];
    if (hits.length === 0) break;
    for (const h of hits) {
      const d = h.document as { id: string; EntryTimestamp?: number; LeaseTrueDom?: number };
      const entryMs = Number(d.EntryTimestamp);
      if (!Number.isFinite(entryMs) || entryMs <= 0) continue;
      const age = Math.max(0, Math.floor((nowMs - entryMs) / DAY_MS));
      const current = Number(d.LeaseTrueDom) || 0;
      if (age - current >= minDrift) out.push({ key: d.id, age });
      if (limit && out.length >= limit) return out;
    }
    if (hits.length < PAGE) break;
    page++;
  }
  return out;
}

async function pushToTypesense(ts: Client, rows: Candidate[]): Promise<{ updated: number; failed: number }> {
  let updated = 0;
  let failed = 0;
  for (let i = 0; i < rows.length; i += TS_CHUNK) {
    const chunk = rows.slice(i, i + TS_CHUNK);
    const docs = chunk.map((r) => ({ id: r.key, LeaseTrueDom: r.age }));
    try {
      const res = await ts.collections(PROPERTIES_COLLECTION).documents().import(docs, { action: 'update' });
      const results = Array.isArray(res) ? res : [];
      for (const r of results) (r as { success?: boolean }).success ? updated++ : failed++;
    } catch (err) {
      // Typesense THROWS ImportError when ANY line fails, exposing per-doc outcomes on
      // err.importResults (a key not in `properties` failing is expected — count it).
      const importResults = (err as { importResults?: { success: boolean }[] }).importResults;
      if (Array.isArray(importResults)) {
        for (const r of importResults) r.success ? updated++ : failed++;
      } else {
        failed += chunk.length;
        console.warn(`   ⚠️  Typesense chunk ${i}-${i + chunk.length} failed:`, (err as Error)?.message ?? err);
      }
    }
    console.log(`   … Typesense ${Math.min(i + TS_CHUNK, rows.length)}/${rows.length} (updated ${updated}, failed ${failed})`);
  }
  return { updated, failed };
}

/** Persist lease_true_dom to the flat column AND full_payload (keyed by listing_key, no scan)
 *  so a later reindex-from-vault carries the floored value instead of reverting to 0. */
async function persistToVault(c: PgClient, rows: Candidate[]): Promise<number> {
  let touched = 0;
  for (let i = 0; i < rows.length; i += VAULT_CHUNK) {
    const chunk = rows.slice(i, i + VAULT_CHUNK);
    const values: string[] = [];
    const params: (string | number)[] = [];
    chunk.forEach((r, j) => {
      values.push(`($${j * 2 + 1}, $${j * 2 + 2}::int)`);
      params.push(r.key, r.age);
    });
    const res = await c.query(
      `UPDATE listings AS l
         SET lease_true_dom = GREATEST(COALESCE(l.lease_true_dom, 0), v.age),
             full_payload   = jsonb_set(COALESCE(l.full_payload, '{}'::jsonb), '{lease_true_dom}', to_jsonb(GREATEST(COALESCE(l.lease_true_dom, 0), v.age)))
       FROM (VALUES ${values.join(', ')}) AS v(key, age)
       WHERE l.listing_key = v.key`,
      params
    );
    touched += res.rowCount ?? 0;
    console.log(`   … vault ${Math.min(i + VAULT_CHUNK, rows.length)}/${rows.length} (rows updated ${touched})`);
  }
  return touched;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const skipVault = process.argv.includes('--skip-vault');
  const limit = Math.max(0, Number(argVal('--limit')) || 0);
  const minDrift = Math.max(1, Number(argVal('--min-drift')) || 1);
  const nowMs = Date.now();

  if (!process.env.TYPESENSE_ADMIN_API_KEY) {
    console.error('❌ TYPESENSE_ADMIN_API_KEY is not set');
    process.exit(1);
  }
  if (!skipVault && !process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL is not set (Session-pooler required, or pass --skip-vault)');
    process.exit(1);
  }

  console.log('========================================');
  console.log('  Backfill LeaseTrueDom (active For-Lease naive-age floor)');
  console.log(`  ${apply ? 'APPLY' : 'DRY-RUN'} · min-drift ${minDrift}d${limit ? ` · limit ${limit}` : ''}${skipVault ? ' · Typesense only' : ''}`);
  console.log('========================================\n');

  const ts = tsClient();
  console.log('🔎 Scanning active For-Lease docs in the `properties` index…');
  const candidates = await findCandidates(ts, nowMs, minDrift, limit);
  const maxAge = candidates.reduce((m, r) => Math.max(m, r.age), 0);
  console.log(`   ${candidates.length} lease doc(s) drifted ≥ ${minDrift}d below their naive age (max age ${maxAge}d).`);

  if (!apply) {
    console.log(`\nDRY-RUN — re-run with --apply to floor LeaseTrueDom for the ${candidates.length} doc(s).`);
    return;
  }
  if (candidates.length === 0) {
    console.log('\nNothing to backfill. Done.');
    return;
  }

  console.log(`\n📤 Pushing LeaseTrueDom to Typesense '${PROPERTIES_COLLECTION}' for ${candidates.length} key(s)…`);
  const { updated, failed } = await pushToTypesense(ts, candidates);
  console.log(`✅ Typesense: ${updated} updated, ${failed} not-in-index/failed (purged keys are expected).`);

  if (skipVault) {
    console.log('\n(--skip-vault) Not persisting to the vault; a full reindex-from-vault would revert these until the nightly sync catches up.');
    return;
  }

  const c = new PgClient({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    console.log(`\n💾 Persisting lease_true_dom to the vault (flat column + full_payload) for ${candidates.length} key(s)…`);
    const touched = await persistToVault(c, candidates);
    console.log(`✅ Vault: ${touched} row(s) updated.`);
  } finally {
    await c.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ backfill-lease-metrics failed:', err?.message ?? err);
    process.exit(1);
  });
