/**
 * Reconcile `sold_listings` (+ `raw_vow_sold`) from the Supabase `listings` vault.
 *
 * WHY THIS EXISTS
 * ───────────────
 * The daily sold sync (ingester Query B) selects closed listings sorted by
 * PurchaseContractDate desc and STOPS paginating at the first PCD older than the
 * sync watermark. PurchaseContractDate is the *agreement* date, but a firm sale
 * enters the VOW feed days later, and a terminate-then-relist resell closes under a
 * NEW MLS# whose sold PCD can already sit behind the advancing watermark. Such a sale
 * is fetched by Query A (ModificationTimestamp cursor) into the `listings` vault as
 * Closed — but Query B's early-stop, or a transient per-row raw_vow_sold upsert
 * failure, can leave it OUT of `raw_vow_sold`/`sold_listings`. That made a sold saved
 * listing badge "Off-market · Terminated" on the dashboard (363 Maria Antonia
 * N13410488). See src/lib/watchlist/disposition.ts + the vault fallback in
 * app/api/watchlist/dispositions/route.ts.
 *
 * The vault is the more-complete store, so this reconciler re-derives the sold records
 * from it using the SAME mappers the ingester uses (no divergent logic), upserting into
 * both raw_vow_sold (the rebuildable AVM anchor / source of truth) and the sold_listings
 * Typesense cache. Idempotent — safe to re-run and safe to schedule (e.g. alongside the
 * twice-weekly recompute) as a completeness backstop.
 *
 * Usage:
 *   npx tsx scripts/admin/reconcile-sold-from-vault.ts N13410488 [N... ]        # targeted keys
 *   npx tsx scripts/admin/reconcile-sold-from-vault.ts --scan [--apply] \
 *       [--include-leases] [--since-days=14 | --updated-since=ISO] [--max-pages=200]
 *
 * Scan mode pages the vault by primary key (cheap JSONB scalar projections — it never
 * streams the ~50KB full_payload during the sweep) and reconciles every closed transaction
 * within the 180-day PurchaseContractDate window that is MISSING from sold_listings.
 *   • SALES only by default. --include-leases also backfills closed LEASES (DealType=leased)
 *     — they power sold_listings lease comps (similarListings.ts) but NOT the rent AVM
 *     (rental_market_index uses active asking rents), so backfilling them is isolated.
 *   • --since-days / --updated-since bounds the sweep to recently-synced rows (the cheap,
 *     schedulable backstop — a window ≥ the schedule gap catches every fresh miss).
 *   • omit both for a FULL-table sweep (heavier server IO; use for a one-time backlog pass).
 * Add --apply to write (dry-run by default). Targeted-key mode always writes (sale or lease).
 */

import 'dotenv/config';
import { getServiceRoleClient } from '../../src/lib/supabase/client';
import {
  isSoldListing,
  extractSoldListingData,
  upsertSoldListings,
} from '../worker/ingester';
import {
  toSoldDocument,
  importSoldBatch,
  getSoldAdminClient,
  windowCutoffMs,
} from '../worker/soldIndexer';
import { deriveDealType, deriveDelistedDealType } from '../../src/lib/sold/dealType';
import { SOLD_LISTINGS_COLLECTION } from '../../src/lib/typesense/soldListingsSchema';

const VAULT_PAGE = 1000;

type Raw = Record<string, any>;

/**
 * The qualifying transaction dealType for the sold path, or null to skip. Always excludes
 * terminated / expired / suspended (owned by the delistedIndexer; isSoldListing over-broadly
 * lumps them in as "closed" — harmless for Query B, which only fetches Closed/Sold, but this
 * reconciler reads the WHOLE vault, so we must guard, or a terminated row would be re-indexed
 * AS a sale since deriveDealType defaults unknown → sold).
 *
 * Leases (deriveDealType → 'leased') are included ONLY when includeLeases is set. Leased docs
 * populate the sold_listings lease comps (similarListings.ts DealType:=leased) but NOT the rent
 * AVM (rental_market_index is built from ACTIVE asking rents), so backfilling them is isolated.
 */
function qualifyingSale(
  ms: string | null | undefined,
  ss: string | null | undefined,
  tt: string | null | undefined,
  includeLeases: boolean
): 'sold' | 'leased' | null {
  if (deriveDelistedDealType(ms) || deriveDelistedDealType(ss)) return null;
  if (!isSoldListing({ MlsStatus: ms, StandardStatus: ss })) return null;
  const dt = deriveDealType(ms ?? null, tt ?? null); // 'sold' | 'leased'
  if (dt === 'leased' && !includeLeases) return null;
  return dt;
}

/** Re-derive raw_vow_sold + sold_listings for one vault payload. Returns the outcome
 *  ('sold'/'leased' on success so callers can tally by kind). */
async function reconcileOne(
  raw: Raw,
  includeLeases: boolean
): Promise<'sold' | 'leased' | 'not-sold' | 'no-date' | 'failed'> {
  const dt = qualifyingSale(raw.MlsStatus, raw.StandardStatus, raw.TransactionType, includeLeases);
  if (!dt) return 'not-sold';
  const rec = extractSoldListingData(raw);
  if (!rec || !rec.listing_key) return 'not-sold';

  // 1) raw_vow_sold (source of truth — so a future soldIndexer backfill keeps it).
  const up = await upsertSoldListings(getServiceRoleClient(), [rec]);
  if (up.failed > 0) {
    console.warn(`   ⚠️  ${rec.listing_key}: raw_vow_sold upsert failed — ${up.errors.join('; ')}`);
    return 'failed';
  }

  // 2) sold_listings Typesense cache — built with the exact ingester mapping.
  const doc = toSoldDocument(
    {
        ...rec,
        mls_status: raw.MlsStatus ?? null,
        transaction_type: raw.TransactionType ?? null,
        // Seller opt-out — toSoldDocument drops the doc when either switch says No.
        internet_display: raw.InternetEntireListingDisplayYN,
        internet_address_display: raw.InternetAddressDisplayYN,
      } as any,
    raw.ListOfficeName ?? null,
    { media: raw.media ?? raw.Media, images: raw.images ?? raw.Images }
  );
  if (!doc) return 'no-date'; // toSoldDocument skips rows without a PurchaseContractDate

  const { failed } = await importSoldBatch(getSoldAdminClient(), [doc]);
  if (failed > 0) return 'failed';
  console.log(`   ✅ ${rec.listing_key} → sold_listings (${doc.DealType}, ${new Date(doc.PurchaseContractDate).toISOString().slice(0, 10)})`);
  return dt; // 'sold' | 'leased' (narrowed by qualifyingSale above)
}

/** Which of these keys already exist in sold_listings (so scan can skip them). */
async function existingSoldKeys(keys: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  if (!keys.length) return found;
  const client = getSoldAdminClient();
  for (let i = 0; i < keys.length; i += 100) {
    const chunk = keys.slice(i, i + 100);
    const res = await client
      .collections(SOLD_LISTINGS_COLLECTION)
      .documents()
      .search({ q: '*', query_by: 'UnparsedAddress', filter_by: `id:[${chunk.join(',')}]`, per_page: 250 });
    for (const h of res.hits ?? []) found.add((h.document as { id: string }).id);
  }
  return found;
}

async function reconcileKeys(keys: string[]): Promise<void> {
  console.log(`\n🔧 Reconciling ${keys.length} key(s) from the vault → raw_vow_sold + sold_listings\n`);
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase.from('listings').select('listing_key, full_payload').in('listing_key', keys);
  if (error) throw new Error(error.message);
  const byKey = new Map<string, Raw>();
  for (const row of (data ?? []) as Array<{ listing_key: string; full_payload: Raw }>) {
    const raw = { ...(row.full_payload ?? {}) };
    if (!raw.ListingKey) raw.ListingKey = row.listing_key; // full_payload should carry it; belt-and-braces
    byKey.set(row.listing_key, raw);
  }

  const tally: Record<string, number> = {};
  for (const key of keys) {
    const raw = byKey.get(key);
    if (!raw) {
      console.warn(`   ⚠️  ${key}: NOT in the vault (listings table) — cannot reconcile`);
      tally['not-in-vault'] = (tally['not-in-vault'] ?? 0) + 1;
      continue;
    }
    // Targeted keys are an explicit request, so reconcile whatever they are (sale or lease).
    const outcome = await reconcileOne(raw, true);
    if (outcome !== 'sold' && outcome !== 'leased') console.log(`   • ${key}: ${outcome}`);
    tally[outcome] = (tally[outcome] ?? 0) + 1;
  }
  console.log(`\n📊 Done: ${JSON.stringify(tally)}`);
}

async function scan(opts: { updatedSince: string | null; maxPages: number; apply: boolean; includeLeases: boolean }): Promise<void> {
  const { updatedSince, maxPages, apply, includeLeases } = opts;
  console.log(`\n🔍 Scanning the vault for closed ${includeLeases ? 'SALES + LEASES' : 'SALES'} (last 180d PCD) missing from sold_listings`);
  console.log(`   window: ${updatedSince ? `updated_at ≥ ${updatedSince}` : 'FULL TABLE'} · ${apply ? 'APPLY (writing)' : 'DRY-RUN'} · maxPages: ${maxPages}\n`);
  const supabase = getServiceRoleClient();
  const cutoffMs = windowCutoffMs();

  let lastKey = '';
  let page = 0;
  const tally: Record<string, number> = {};
  let candidatesTotal = 0;

  for (; page < maxPages; page++) {
    // Lightweight JSONB scalar PROJECTIONS only — never stream the ~50KB full_payload per
    // row (Disk IO budget, CLAUDE.md §12). Full payload is fetched below solely for the
    // handful of rows that turn out to be missing.
    let q = supabase
      .from('listings')
      .select('listing_key, ms:full_payload->>MlsStatus, ss:full_payload->>StandardStatus, tt:full_payload->>TransactionType, pcd:full_payload->>PurchaseContractDate')
      .order('listing_key', { ascending: true })
      .limit(VAULT_PAGE);
    if (updatedSince) q = q.gte('updated_at', updatedSince);
    if (lastKey) q = q.gt('listing_key', lastKey);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Array<{ listing_key: string; ms: string | null; ss: string | null; tt: string | null; pcd: string | null }>;
    if (rows.length === 0) break;
    lastKey = rows[rows.length - 1].listing_key;

    // In-window closed transactions on this page (from the cheap projection).
    const candidates: string[] = [];
    for (const row of rows) {
      if (!qualifyingSale(row.ms, row.ss, row.tt, includeLeases)) continue;
      const pcd = row.pcd ? new Date(row.pcd).getTime() : NaN;
      if (!Number.isFinite(pcd) || pcd < cutoffMs) continue;
      candidates.push(row.listing_key);
    }
    candidatesTotal += candidates.length;

    // Only reconcile the ones NOT already in sold_listings.
    const have = await existingSoldKeys(candidates);
    const missing = candidates.filter((k) => !have.has(k));
    if (missing.length) {
      console.log(`   📄 page ${page + 1}: ${candidates.length} in-window, ${missing.length} missing from sold_listings`);
      tally['missing'] = (tally['missing'] ?? 0) + missing.length;
      if (apply) {
        // Now (and only now) pull the full payload for the missing rows to reconcile.
        const { data: full, error: fErr } = await supabase
          .from('listings')
          .select('listing_key, full_payload')
          .in('listing_key', missing);
        if (fErr) throw new Error(fErr.message);
        for (const row of (full ?? []) as Array<{ listing_key: string; full_payload: Raw }>) {
          const raw = { ...(row.full_payload ?? {}) };
          if (!raw.ListingKey) raw.ListingKey = row.listing_key;
          const outcome = await reconcileOne(raw, includeLeases);
          tally[outcome] = (tally[outcome] ?? 0) + 1;
        }
      } else {
        for (const k of missing) console.log(`      would reconcile ${k}`);
      }
    }

    if (rows.length < VAULT_PAGE) break;
  }

  console.log(`\n📊 Scan complete: pages=${page}, in-window seen=${candidatesTotal}, ${JSON.stringify(tally)}`);
  if (!apply && (tally['missing'] ?? 0) > 0) console.log(`   Re-run with --apply to write the ${tally['missing']} missing record(s).`);
}

/** Read a `--flag=value` arg. */
function argVal(args: string[], name: string): string | null {
  const hit = args.find((a) => a.startsWith(`${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : null;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--scan')) {
    const maxPages = Math.max(1, Number(argVal(args, '--max-pages')) || 200);
    // Window: explicit --updated-since=ISO, else --since-days=N (a bounded backstop), else
    // full table. Date math avoided at module scope; Date.now() is fine in a CLI entrypoint.
    let updatedSince = argVal(args, '--updated-since');
    const sinceDays = Number(argVal(args, '--since-days'));
    if (!updatedSince && Number.isFinite(sinceDays) && sinceDays > 0) {
      updatedSince = new Date(Date.now() - sinceDays * 86_400_000).toISOString();
    }
    await scan({
      updatedSince,
      maxPages,
      apply: args.includes('--apply'),
      includeLeases: args.includes('--include-leases'),
    });
    return;
  }
  const keys = args.filter((a) => /^[A-Za-z]\d{5,10}$/.test(a));
  if (keys.length === 0) {
    console.error('Usage: reconcile-sold-from-vault.ts <listingKey...> | --scan [--apply] [--include-leases] [--since-days=N | --updated-since=ISO] [--max-pages=N]');
    process.exit(1);
  }
  await reconcileKeys(keys);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ reconcile-sold-from-vault failed:', err?.message ?? err);
    process.exit(1);
  });
