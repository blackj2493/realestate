/**
 * Reconcile `raw_vow_sold` (+ `sold_listings`) from the `property_campaign_history` ledger.
 *
 * WHY THIS EXISTS
 * ───────────────
 * The daily sold sync (ingester Query B) is a delta crawl over ModificationTimestamp. A
 * terminate-then-relist resell closes under a NEW MLS# whose sold record can enter the feed
 * BEHIND the advancing watermark — so Query B never fetches it, and it never reaches
 * `raw_vow_sold` (the AVM anchor / source of truth) nor the `sold_listings` cache. Its close
 * survives ONLY in `property_campaign_history`, which is populated by an UNFILTERED by-ADDRESS
 * query (fetchCampaignsByAddress) that has no status/timestamp filter and therefore catches the
 * relist. Concrete case: 7 Stemford Rd, Brampton — W13090288 terminated 2026-05-31, relist
 * W13224994 SOLD 2026-06-12 $885k, present in campaign history but absent from raw_vow_sold.
 *
 * The sibling `reconcile-sold-from-vault.ts` recovers such misses only when Query A captured
 * the close into the `listings` vault — but a relist born-and-closed inside the delta window is
 * usually NOT in the vault either (measured: ~786 of ~799 missing closes are not-in-vault). So
 * this reconciler enumerates SOLD/LEASED events from campaign history that are missing from
 * raw_vow_sold, RE-FETCHES each by MLS# from the VOW feed (a by-key fetch reliably returns what
 * the delta crawl missed — same reason the by-address fetch works), and re-derives the comp row
 * with the EXACT ingester mappers (no divergent logic). Idempotent (both writes are upserts
 * on listing_key) — safe to re-run and to schedule as a nightly completeness backstop.
 *
 * Downstream: raw_vow_sold feeds property_sale_history + the AVM trend/estimates and the
 * sold_listings cache feeds search + comps, so a recovered close repairs all of them.
 *
 * Usage:
 *   npx tsx scripts/admin/reconcile-sold-from-campaign-history.ts W13224994 [W... ]   # targeted keys
 *   npx tsx scripts/admin/reconcile-sold-from-campaign-history.ts --scan [--apply] \
 *       [--include-leases] [--window-days=180] [--archive] \
 *       [--since-days=N | --fetched-since=ISO] [--limit=N] [--max-rows=N]
 *
 * Scan mode keyset-pages campaign history, finds SOLD (and, with --include-leases, LEASED)
 * events with a real close price that are MISSING from raw_vow_sold, and reconciles them.
 *   • Default bounds to the 180-day sold_listings comp window (both stores). --archive also
 *     recovers older closes into raw_vow_sold (the ~2yr AVM archive; not the 180d cache).
 *   • --since-days / --fetched-since limit the sweep to recently-refreshed ledger rows — the
 *     cheap, schedulable go-forward backstop (a window ≥ the schedule gap catches every fresh miss).
 *   • omit both for a FULL sweep (the one-time historical backfill).
 *   • --limit caps how many missing keys are reconciled in one run (bounded first pass);
 *     --max-rows caps ledger rows scanned.
 * Add --apply to write + hit the VOW feed (dry-run by default: detects + lists, no feed calls,
 * no writes). Targeted-key mode always writes.
 */

import 'dotenv/config';
import { getServiceRoleClient } from '../../src/lib/supabase/client';
import { isSoldListing, extractSoldListingData, upsertSoldListings } from '../worker/ingester';
import { toSoldDocument, importSoldBatch, getSoldAdminClient, windowCutoffMs } from '../worker/soldIndexer';
import { enrichListingsWithMedia } from '../worker/mediaEnrichment';
import { deriveDealType, deriveDelistedDealType } from '../../src/lib/sold/dealType';
import { ProptXClient } from '../../src/lib/proptx/client';

type Raw = Record<string, any>;

const LEDGER_PAGE = 500; // campaign-history rows per keyset page
const CHECK_CHUNK = 200; // keys per raw_vow_sold existence check
const VOW_TOKEN = (process.env.PROPTX_VOW_TOKEN || '').trim();
const FEED_DELAY_MS = Math.max(0, Number(process.env.RECONCILE_FEED_DELAY_MS) || 400);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A SOLD/LEASED campaign event worth recovering. */
interface SoldEvent {
  listingKey: string;
  closeMs: number; // end_date epoch ms
  dealType: 'sold' | 'leased';
}

/**
 * Same guard as reconcile-sold-from-vault: exclude terminated/expired/suspended (owned by the
 * delistedIndexer; deriveDealType defaults unknown → 'sold', so a delisted row must be rejected
 * before it is re-indexed AS a sale). Leases only when includeLeases.
 */
function qualifyingSale(
  ms: string | null | undefined,
  ss: string | null | undefined,
  tt: string | null | undefined,
  includeLeases: boolean
): 'sold' | 'leased' | null {
  if (deriveDelistedDealType(ms) || deriveDelistedDealType(ss)) return null;
  if (!isSoldListing({ MlsStatus: ms, StandardStatus: ss })) return null;
  const dt = deriveDealType(ms ?? null, tt ?? null);
  if (dt === 'leased' && !includeLeases) return null;
  return dt;
}

/** Re-fetch one listing from the VOW feed by MLS#, media-enriched, in the ingester's raw shape. */
async function fetchRawByKey(client: ProptXClient, key: string): Promise<Raw | null> {
  try {
    const raw = (await client.getProperty(key)) as Raw;
    if (!raw || !(raw.ListingKey || raw.listing_key)) return null;
    if (!raw.ListingKey) raw.ListingKey = key; // belt-and-braces for the media join key
    await enrichListingsWithMedia([raw], VOW_TOKEN); // best-effort, mutates raw.media
    return raw;
  } catch (err: any) {
    // 404 / gone from the feed → the by-key re-fetch can't recover it (synthesis-from-event
    // is a possible future fallback; logged, not fatal).
    console.warn(`   ⚠️  ${key}: VOW re-fetch failed — ${err?.message ?? err}`);
    return null;
  }
}

/** Re-derive raw_vow_sold (always) + sold_listings (only inside the window) for one raw payload. */
async function reconcileOne(
  raw: Raw,
  includeLeases: boolean,
  windowMs: number
): Promise<'sold' | 'leased' | 'not-sold' | 'no-date' | 'failed'> {
  const dt = qualifyingSale(raw.MlsStatus, raw.StandardStatus, raw.TransactionType, includeLeases);
  if (!dt) return 'not-sold';
  const rec = extractSoldListingData(raw);
  if (!rec || !rec.listing_key) return 'not-sold';

  // 1) raw_vow_sold — the AVM anchor / source of truth. Written for every recovered close,
  //    in-window or archive, so a future soldIndexer backfill keeps it.
  const up = await upsertSoldListings(getServiceRoleClient(), [rec]);
  if (up.failed > 0) {
    console.warn(`   ⚠️  ${rec.listing_key}: raw_vow_sold upsert failed — ${up.errors.join('; ')}`);
    return 'failed';
  }

  // 2) sold_listings — the 180-day Typesense comp cache. Index ONLY when the close is inside
  //    the window (an older archive row must not enter the rolling cache).
  const doc = toSoldDocument(
    { ...rec, mls_status: raw.MlsStatus ?? null, transaction_type: raw.TransactionType ?? null } as any,
    raw.ListOfficeName ?? null,
    { media: raw.media ?? raw.Media, images: raw.images ?? raw.Images }
  );
  if (!doc) return 'no-date'; // toSoldDocument skips rows without a PurchaseContractDate
  if (doc.PurchaseContractDate >= windowMs) {
    const { failed } = await importSoldBatch(getSoldAdminClient(), [doc]);
    if (failed > 0) return 'failed';
    console.log(`   ✅ ${rec.listing_key} → raw_vow_sold + sold_listings (${doc.DealType}, ${new Date(doc.PurchaseContractDate).toISOString().slice(0, 10)})`);
  } else {
    console.log(`   ✅ ${rec.listing_key} → raw_vow_sold (archive; ${new Date(doc.PurchaseContractDate).toISOString().slice(0, 10)} outside ${Math.round((Date.now() - windowMs) / 86_400_000)}d window)`);
  }
  return dt;
}

/** Which of these keys already have a raw_vow_sold row (so scan can skip them). */
async function existingRawVowSoldKeys(keys: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  const supabase = getServiceRoleClient();
  for (let i = 0; i < keys.length; i += CHECK_CHUNK) {
    const chunk = keys.slice(i, i + CHECK_CHUNK);
    const { data, error } = await supabase.from('raw_vow_sold').select('listing_key').in('listing_key', chunk);
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as Array<{ listing_key: string }>) found.add(r.listing_key);
  }
  return found;
}

async function reconcileKeys(keys: string[]): Promise<void> {
  if (!VOW_TOKEN) throw new Error('PROPTX_VOW_TOKEN is not set — cannot re-fetch from the VOW feed');
  console.log(`\n🔧 Reconciling ${keys.length} key(s) from the VOW feed → raw_vow_sold + sold_listings\n`);
  const client = new ProptXClient(VOW_TOKEN, 'VOW');
  const windowMs = windowCutoffMs();
  const tally: Record<string, number> = {};
  for (const key of keys) {
    const raw = await fetchRawByKey(client, key);
    if (!raw) {
      tally['feed-miss'] = (tally['feed-miss'] ?? 0) + 1;
      continue;
    }
    const outcome = await reconcileOne(raw, true, windowMs); // targeted = reconcile whatever it is
    if (outcome !== 'sold' && outcome !== 'leased') console.log(`   • ${key}: ${outcome}`);
    tally[outcome] = (tally[outcome] ?? 0) + 1;
    if (FEED_DELAY_MS) await sleep(FEED_DELAY_MS);
  }
  console.log(`\n📊 Done: ${JSON.stringify(tally)}`);
}

interface ScanOpts {
  apply: boolean;
  includeLeases: boolean;
  archive: boolean;
  windowMs: number;
  fetchedSince: string | null;
  limit: number;
  maxRows: number;
}

async function scan(opts: ScanOpts): Promise<void> {
  const { apply, includeLeases, archive, windowMs, fetchedSince, limit, maxRows } = opts;
  console.log(`\n🔍 Scanning property_campaign_history for closed ${includeLeases ? 'SALES + LEASES' : 'SALES'} missing from raw_vow_sold`);
  console.log(
    `   window: ${archive ? 'ALL ages (archive)' : `last ${Math.round((Date.now() - windowMs) / 86_400_000)}d`}` +
      ` · rows: ${fetchedSince ? `fetched_at ≥ ${fetchedSince}` : 'FULL LEDGER'}` +
      ` · ${apply ? 'APPLY (writing + VOW re-fetch)' : 'DRY-RUN'} · limit: ${limit || '∞'} · maxRows: ${maxRows}\n`
  );
  if (apply && !VOW_TOKEN) throw new Error('PROPTX_VOW_TOKEN is not set — --apply needs the VOW feed');

  const supabase = getServiceRoleClient();
  const client = apply ? new ProptXClient(VOW_TOKEN, 'VOW') : null;

  const seen = new Set<string>(); // dedupe keys across pages
  const tally: Record<string, number> = {};
  let candidatesTotal = 0;
  let reconciled = 0;
  let lastHash = '';
  let rowsScanned = 0;

  outer: for (let page = 0; rowsScanned < maxRows; page++) {
    let q = supabase
      .from('property_campaign_history')
      .select('property_hash, events, fetched_at')
      .order('property_hash', { ascending: true })
      .limit(LEDGER_PAGE);
    if (fetchedSince) q = q.gte('fetched_at', fetchedSince);
    if (lastHash) q = q.gt('property_hash', lastHash);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Array<{ property_hash: string; events: any[]; fetched_at: string }>;
    if (rows.length === 0) break;
    lastHash = rows[rows.length - 1].property_hash;
    rowsScanned += rows.length;

    // Extract qualifying closed events on this page.
    const events: SoldEvent[] = [];
    for (const row of rows) {
      for (const e of Array.isArray(row.events) ? row.events : []) {
        const status = String(e?.status ?? '').toLowerCase();
        if (status !== 'sold' && !(includeLeases && status === 'leased')) continue;
        const close = Number(e?.close_price ?? 0);
        if (!(close > 0)) continue;
        const key = String(e?.listing_key ?? '');
        if (!key || seen.has(key)) continue;
        const closeMs = e?.end_date ? Date.parse(e.end_date) : NaN;
        if (!Number.isFinite(closeMs)) continue;
        if (!archive && closeMs < windowMs) continue; // out of the comp window and not archiving
        seen.add(key);
        events.push({ listingKey: key, closeMs, dealType: status === 'leased' ? 'leased' : 'sold' });
      }
    }
    if (events.length === 0) {
      if (rows.length < LEDGER_PAGE) break;
      continue;
    }

    // Only the ones NOT already in raw_vow_sold are misses.
    const have = await existingRawVowSoldKeys(events.map((e) => e.listingKey));
    const missing = events.filter((e) => !have.has(e.listingKey));
    candidatesTotal += missing.length;

    if (missing.length) {
      console.log(`   📄 page ${page + 1}: ${events.length} closed events, ${missing.length} missing from raw_vow_sold`);
      for (const ev of missing) {
        if (limit && reconciled >= limit) {
          console.log(`   ⏹️  reached --limit=${limit}; stopping.`);
          break outer;
        }
        tally['missing'] = (tally['missing'] ?? 0) + 1;
        if (!apply) {
          console.log(`      would reconcile ${ev.listingKey} (${ev.dealType}, ${new Date(ev.closeMs).toISOString().slice(0, 10)})`);
          continue;
        }
        const raw = await fetchRawByKey(client as ProptXClient, ev.listingKey);
        if (!raw) {
          tally['feed-miss'] = (tally['feed-miss'] ?? 0) + 1;
        } else {
          const outcome = await reconcileOne(raw, includeLeases, windowMs);
          tally[outcome] = (tally[outcome] ?? 0) + 1;
        }
        reconciled++;
        if (FEED_DELAY_MS) await sleep(FEED_DELAY_MS);
      }
    }

    if (rows.length < LEDGER_PAGE) break;
  }

  console.log(`\n📊 Scan complete: ledger rows=${rowsScanned}, missing candidates=${candidatesTotal}, ${JSON.stringify(tally)}`);
  if (!apply && (tally['missing'] ?? 0) > 0) {
    console.log(`   Re-run with --apply to re-fetch + write the ${tally['missing']} missing record(s).`);
  }
}

function argVal(args: string[], name: string): string | null {
  const hit = args.find((a) => a.startsWith(`${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : null;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--scan')) {
    const windowDays = Math.max(1, Number(argVal(args, '--window-days')) || 180);
    let fetchedSince = argVal(args, '--fetched-since');
    const sinceDays = Number(argVal(args, '--since-days'));
    if (!fetchedSince && Number.isFinite(sinceDays) && sinceDays > 0) {
      fetchedSince = new Date(Date.now() - sinceDays * 86_400_000).toISOString();
    }
    await scan({
      apply: args.includes('--apply'),
      includeLeases: args.includes('--include-leases'),
      archive: args.includes('--archive'),
      windowMs: windowCutoffMs(windowDays),
      fetchedSince,
      limit: Math.max(0, Number(argVal(args, '--limit')) || 0),
      maxRows: Math.max(1, Number(argVal(args, '--max-rows')) || 1_000_000),
    });
    return;
  }

  const keys = args.filter((a) => /^[A-Za-z]\d{5,10}$/.test(a));
  if (keys.length === 0) {
    console.error(
      'Usage: reconcile-sold-from-campaign-history.ts <listingKey...> | --scan [--apply] [--include-leases] [--window-days=N] [--archive] [--since-days=N | --fetched-since=ISO] [--limit=N] [--max-rows=N]'
    );
    process.exit(1);
  }
  await reconcileKeys(keys);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ reconcile-sold-from-campaign-history failed:', err?.message ?? err);
    process.exit(1);
  });
