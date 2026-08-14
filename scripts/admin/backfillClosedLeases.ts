/**
 * Backfill closed LEASES into raw_vow_sold.
 *
 * The May-2026 bulk load pulled ~2.7 years of closed SALES but no leases; leases only
 * began arriving with the nightly delta on 2026-07-18, so the archive starts in April
 * 2026. Measured against the feed on 2026-08-14 (quarterly $count over CloseDate):
 *
 *   feed closed leases, all time   264,276   (oldest bucket 2024 Q3)
 *   raw_vow_sold closed leases      46,299
 *
 * ~218,000 rows we are entitled to and never asked for.
 *
 * THIS IS TIME-LIMITED. Our oldest closed sale is 2023-09-30 but the feed's earliest
 * bucket is now 2024 Q3 — we are holding sales the feed no longer serves, which puts
 * retention at a ~24-month ROLLING window. Every quarter that passes, a quarter of
 * lease history ages out permanently. It cannot be recovered later.
 *
 * Reuses extractSoldListingData/upsertSoldListings from the ingester rather than
 * reimplementing them: property_hash must match the sale-side rows exactly or the
 * AVM/comp joins silently miss. Closed leases carry StandardStatus='Closed' and
 * MlsStatus='Leased', so isSoldListing already accepts them unchanged.
 *
 * Idempotent and resumable — keys already in raw_vow_sold are skipped, so a killed run
 * picks up where it stopped. Walks oldest-quarter-first so the material closest to
 * ageing out lands first.
 *
 * Usage:
 *   npx tsx scripts/admin/backfillClosedLeases.ts                  # dry-run, counts only
 *   npx tsx scripts/admin/backfillClosedLeases.ts --apply
 *   npx tsx scripts/admin/backfillClosedLeases.ts --apply --from 2024-07-01 --to 2025-01-01
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { extractSoldListingData, upsertSoldListings } from '../worker/ingester';

dotenv.config({ path: ['.env.local', '.env'] });

const APPLY = process.argv.includes('--apply');
const arg = (flag: string): string | null => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
};

const API_BASE_URL = (process.env.AMPRE_API_URL || 'https://query.ampre.ca/odata').trim();
const VOW_TOKEN = (process.env.PROPTX_VOW_TOKEN || '').trim();
const PAGE = 500;              // OData $top; the feed caps well above this
const PAGE_DELAY_MS = 250;     // be a good citizen — this is a long walk
const PRESENCE_CHUNK = 500;    // listing_key IN (...) chunk for the skip check

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const n = (x: number) => x.toLocaleString('en-US');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Month boundaries from `from` to `to`, oldest first. */
function months(from: string, to: string): Array<{ from: string; to: string }> {
  const out: Array<{ from: string; to: string }> = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d < end) {
    const next = new Date(d);
    next.setUTCMonth(next.getUTCMonth() + 1);
    out.push({ from: d.toISOString().slice(0, 10), to: (next < end ? next : end).toISOString().slice(0, 10) });
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out;
}

async function feed(path: string, tries = 3): Promise<any> {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`${API_BASE_URL}${path}`, {
        headers: { Authorization: `Bearer ${VOW_TOKEN}`, Accept: 'application/json' },
      });
      if (r.ok) return r.json();
      // 429/5xx are worth another go; a 4xx is not.
      if (r.status < 500 && r.status !== 429) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
      console.warn(`   ⚠️  ${r.status} — retry ${i + 1}/${tries}`);
    } catch (e: any) {
      if (i === tries - 1) throw e;
      console.warn(`   ⚠️  ${e.message} — retry ${i + 1}/${tries}`);
    }
    await sleep(1000 * (i + 1));
  }
  throw new Error('unreachable');
}

const leaseFilter = (from: string, to: string) =>
  `TransactionType eq 'For Lease' and StandardStatus eq 'Closed' ` +
  `and CloseDate ge ${from} and CloseDate lt ${to}`;

/** Which of these keys are already stored (resume/idempotency). */
async function alreadyStored(keys: string[]): Promise<Set<string>> {
  const seen = new Set<string>();
  for (let i = 0; i < keys.length; i += PRESENCE_CHUNK) {
    const chunk = keys.slice(i, i + PRESENCE_CHUNK);
    const { data, error } = await sb.from('raw_vow_sold').select('listing_key').in('listing_key', chunk);
    if (error) throw new Error(`presence check: ${error.message}`);
    for (const r of data ?? []) seen.add(r.listing_key);
  }
  return seen;
}

async function main() {
  if (!VOW_TOKEN) throw new Error('PROPTX_VOW_TOKEN missing');

  const FROM = arg('--from') ?? '2024-07-01';
  const TO = arg('--to') ?? new Date().toISOString().slice(0, 10);
  const windows = months(FROM, TO);

  console.log(`${APPLY ? 'APPLY' : 'DRY-RUN'} — closed leases ${FROM} → ${TO} (${windows.length} months, oldest first)\n`);

  let feedTotal = 0, fetched = 0, skipped = 0, upserted = 0, failed = 0;
  const t0 = Date.now();

  for (const w of windows) {
    const filter = encodeURIComponent(leaseFilter(w.from, w.to));
    const head = await feed(`/Property?$filter=${filter}&$top=0&$count=true`);
    const total = head['@odata.count'] ?? 0;
    feedTotal += total;
    if (total === 0) { console.log(`   ${w.from}  feed 0 — skip`); continue; }

    if (!APPLY) { console.log(`   ${w.from}  feed ${n(total).padStart(7)}`); continue; }

    let got = 0, mUp = 0, mSkip = 0, mFail = 0;
    for (let skip = 0; skip < total; skip += PAGE) {
      const page = await feed(
        `/Property?$filter=${filter}&$top=${PAGE}&$skip=${skip}&$orderby=ListingKey`
      );
      const rows: any[] = page.value ?? [];
      if (rows.length === 0) break;
      got += rows.length;

      const stored = await alreadyStored(rows.map((r) => r.ListingKey).filter(Boolean));
      const fresh = rows.filter((r) => r.ListingKey && !stored.has(r.ListingKey));
      mSkip += rows.length - fresh.length;
      if (fresh.length === 0) { await sleep(PAGE_DELAY_MS); continue; }

      // Same extractor as the nightly sync — property_hash must match the sale rows.
      const records = fresh.map(extractSoldListingData).filter((r): r is NonNullable<typeof r> => r !== null);
      if (records.length !== fresh.length) {
        console.warn(`   ⚠️  ${fresh.length - records.length} rows rejected by isSoldListing`);
      }
      if (records.length > 0) {
        const res = await upsertSoldListings(sb, records);
        mUp += res.inserted; mFail += res.failed;
        for (const e of res.errors.slice(0, 2)) console.warn(`   ⚠️  ${e}`);
      }
      await sleep(PAGE_DELAY_MS);
    }

    fetched += got; upserted += mUp; skipped += mSkip; failed += mFail;
    const el = ((Date.now() - t0) / 1000 / 60).toFixed(1);
    console.log(`   ${w.from}  feed ${n(total).padStart(7)}  new ${n(mUp).padStart(7)}  had ${n(mSkip).padStart(7)}` +
                `${mFail ? `  FAILED ${n(mFail)}` : ''}   [${el}m]`);
  }

  console.log(`\nfeed rows in range: ${n(feedTotal)}`);
  if (!APPLY) { console.log('(dry-run — nothing written. Re-run with --apply)'); return; }
  console.log(`fetched ${n(fetched)} · upserted ${n(upserted)} · already had ${n(skipped)} · failed ${n(failed)}`);
  console.log(`elapsed ${((Date.now() - t0) / 1000 / 60).toFixed(1)}m`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => { console.error('❌ failed:', e?.message || e); process.exit(1); });
