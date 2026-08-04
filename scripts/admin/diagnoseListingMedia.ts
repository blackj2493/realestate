/**
 * Per-listing photo diagnostic — answers "why does THIS listing show no images?"
 *
 * The detail page renders `listings.media_urls` (getListingDetail.ts), so a blank
 * gallery has exactly four possible causes. This script distinguishes them in one
 * read-only pass, then names the fix:
 *
 *   A. VOW GATING       — the record is sold/leased/off-market and the viewer is
 *                         anonymous. gateVowDerived() empties media_urls per request;
 *                         the row itself is fine. Not a data bug.
 *   B. NO MEDIUM VARIANT— AMPRE has photos for the listing, but none at
 *                         ImageSizeDescription='Medium'. fetchMediaForKeys pins the
 *                         server-side filter to Medium, so the listing is stored as a
 *                         permanent false-empty. (Fixed by the size fallback in
 *                         mediaEnrichment.ts — this script proves whether it applied.)
 *   C. NEVER RECONCILED — AMPRE has Medium photos and we simply never re-fetched them.
 *                         Query A only revisits a listing when ModificationTimestamp
 *                         moves, and a photos-only update bumps PhotosChangeTimestamp
 *                         instead; the nightly Query A2 sweep is bounded, so a listing
 *                         can sit empty indefinitely.
 *   D. GENUINELY EMPTY  — AMPRE has zero /Media records at any size. Nothing to show;
 *                         the text-only fallback is correct (§6.3(c) forbids a stock
 *                         placeholder).
 *
 * Read-only: no Supabase writes, no Typesense writes, no AMPRE mutations. Compliance —
 * raw feed values are printed verbatim, never transformed by an LLM (§4); the
 * LargestNoWatermark variant is reported for completeness but flagged as unusable,
 * since §6.3(c) requires the brokerage watermark on every displayed image.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/admin/diagnoseListingMedia.ts X13163816
 *   npx tsx --env-file=.env.local scripts/admin/diagnoseListingMedia.ts X13163816 --vow
 *
 * Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PROPTX_IDX_TOKEN
 *      (PROPTX_VOW_TOKEN when --vow is passed, for sold/off-market records).
 */
import 'dotenv/config';
import { getServiceRoleClient } from '../../src/lib/supabase/client';

const API_BASE_URL = (process.env.AMPRE_API_URL || 'https://query.ampre.ca/odata').trim();

const LISTING_KEY = process.argv[2];
const USE_VOW = process.argv.includes('--vow');

/** Sizes we can legally display: the watermark is URL-baked into these variants. */
const USABLE_SIZES = new Set(['Medium', 'Large', 'Largest', 'Thumbnail']);

if (!LISTING_KEY) {
  console.error('Usage: npx tsx --env-file=.env.local scripts/admin/diagnoseListingMedia.ts <ListingKey> [--vow]');
  process.exit(1);
}

interface MediaRow {
  MediaURL?: string;
  MediaKey?: string;
  MediaObjectID?: string;
  MediaCategory?: string;
  MediaStatus?: string;
  ImageSizeDescription?: string;
  Order?: number;
  ResourceRecordKey?: string;
}

/**
 * Every /Media record for one listing, at EVERY size — deliberately unlike the ETL,
 * which pins ImageSizeDescription='Medium'. That difference is the whole point: it is
 * what separates cause B from cause D. Pages with $skip (AMPRE caps responses at 100
 * and emits no @odata.nextLink).
 */
async function fetchAllMedia(key: string, token: string): Promise<MediaRow[]> {
  const filter = `ResourceRecordKey eq '${key}' and ResourceName eq 'Property'`;
  const out: MediaRow[] = [];
  const PAGE = 100;
  for (let skip = 0; ; skip += PAGE) {
    const url =
      `${API_BASE_URL}/Media?$filter=${encodeURIComponent(filter)}` +
      `&$orderby=Order&$top=${PAGE}&$skip=${skip}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (!res.ok) {
      throw new Error(`AMPRE /Media HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    const body = (await res.json()) as { value?: MediaRow[] };
    const rows = body.value ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

function line(label: string, value: unknown): void {
  console.log(`  ${label.padEnd(26)}: ${value === undefined || value === null || value === '' ? '—' : String(value)}`);
}

(async () => {
  const token = USE_VOW ? process.env.PROPTX_VOW_TOKEN : process.env.PROPTX_IDX_TOKEN;
  const supabase = getServiceRoleClient();

  console.log(`\n═══ Photo diagnostic for ${LISTING_KEY} ═══\n`);

  // ── 1. What the detail page would actually render ──────────────────────────
  const { data: row, error } = await supabase
    .from('listings')
    .select('listing_key, city, standard_status, media_urls, created_at, synced_at, full_payload')
    .eq('listing_key', LISTING_KEY)
    .maybeSingle();

  if (error) {
    console.error(`❌ Supabase read failed: ${error.message}`);
    process.exit(1);
  }

  const payload = (row?.full_payload ?? {}) as Record<string, unknown>;
  const storedUrls: string[] = Array.isArray(row?.media_urls) ? (row!.media_urls as string[]) : [];

  console.log('── listings row ──');
  if (!row) {
    console.log('  (no row — this listing is not in the active `listings` table at all)');
  } else {
    line('city', row.city);
    line('standard_status (flat)', row.standard_status);
    line('StandardStatus', payload.StandardStatus);
    line('MlsStatus', payload.MlsStatus);
    line('UnparsedAddress', payload.UnparsedAddress);
    line('created_at', row.created_at);
    line('synced_at', row.synced_at);
    line('ModificationTimestamp', payload.ModificationTimestamp);
    line('PhotosChangeTimestamp', payload.PhotosChangeTimestamp);
    line('PhotosCount (feed)', payload.PhotosCount);
    line('media_urls length', storedUrls.length);
    line('media_urls[0]', storedUrls[0]);
    const ageDays = row.created_at
      ? Math.floor((Date.now() - new Date(row.created_at as string).getTime()) / 86_400_000)
      : null;
    line('row age (days)', ageDays);
  }

  // ── 2. Sold fallback: getListingDetail recovers sold photos from raw_vow_sold ──
  const { data: soldRow } = await supabase
    .from('raw_vow_sold')
    .select('listing_key, photos')
    .eq('listing_key', LISTING_KEY)
    .maybeSingle();
  const soldPhotos = Array.isArray(soldRow?.photos) ? (soldRow!.photos as unknown[]) : [];
  console.log('\n── raw_vow_sold row ──');
  line('present', soldRow ? 'yes' : 'no');
  if (soldRow) line('photos length', soldPhotos.length);

  // ── 3. Ground truth: what AMPRE actually holds, at every size ──────────────
  console.log('\n── AMPRE /Media (all sizes) ──');
  let all: MediaRow[] = [];
  let ampreOk = false;
  if (!token) {
    console.log(`  ⚠️  ${USE_VOW ? 'PROPTX_VOW_TOKEN' : 'PROPTX_IDX_TOKEN'} not set — skipping the live probe.`);
    console.log('     Without it, causes B / C / D cannot be told apart.');
  } else {
    try {
      all = await fetchAllMedia(LISTING_KEY, token);
      ampreOk = true;
    } catch (err) {
      console.log(`  ❌ ${(err as Error).message}`);
    }
  }

  const bySize = new Map<string, MediaRow[]>();
  const photos = all.filter((m) => m.MediaURL && m.MediaStatus !== 'Deleted');
  for (const m of photos) {
    const size = m.ImageSizeDescription ?? '(none)';
    const arr = bySize.get(size);
    if (arr) arr.push(m);
    else bySize.set(size, [m]);
  }

  if (ampreOk) {
    line('total records', all.length);
    line('usable (not Deleted)', photos.length);
    if (bySize.size === 0) {
      console.log('  (no size variants — AMPRE holds no photos for this key)');
    }
    for (const [size, rows] of [...bySize.entries()].sort()) {
      const usable = USABLE_SIZES.has(size);
      console.log(
        `  ${size.padEnd(26)}: ${String(rows.length).padStart(3)} photo(s)` +
          (usable ? '' : '   ⛔ not displayable (§6.3(c): watermark stripped)')
      );
    }
    const sample = bySize.get('Medium')?.[0] ?? photos[0];
    if (sample) {
      console.log(`\n  sample URL: ${sample.MediaURL}`);
    }
  }

  // ── 4. Verdict ─────────────────────────────────────────────────────────────
  const mediumCount = bySize.get('Medium')?.length ?? 0;
  const usableCount = [...bySize.entries()]
    .filter(([size]) => USABLE_SIZES.has(size))
    .reduce((n, [, rows]) => n + rows.length, 0);
  const statusText = String(row?.standard_status ?? payload.MlsStatus ?? payload.StandardStatus ?? '').toLowerCase();
  const isTerminal = /sold|closed|leased|terminated|expired|suspended/.test(statusText);

  console.log('\n── verdict ──');
  if (storedUrls.length > 0) {
    if (isTerminal) {
      console.log('  A. VOW GATING. The row HAS photos; gateVowDerived() strips them per-request for');
      console.log('     anonymous visitors because the record is not Active. Sign in (as a consumer who');
      console.log('     has accepted the VOW Terms) and the gallery fills. No data fix needed.');
    } else {
      console.log(`  ✅ The row holds ${storedUrls.length} photo URL(s) and the listing is not VOW-gated.`);
      console.log('     If the page is still blank the fault is downstream (CDN 404 / render), not ingest.');
      console.log('     Check that the sample URL above loads in a browser.');
    }
  } else if (!ampreOk) {
    console.log('  ⚠️  Inconclusive — media_urls is empty but the live AMPRE probe did not run.');
    console.log('     Re-run with the appropriate PROPTX token set.');
  } else if (usableCount === 0) {
    console.log('  D. GENUINELY EMPTY. AMPRE has no displayable photos for this listing. The text-only');
    console.log('     card is correct — §6.3(c) forbids substituting a stock placeholder.');
  } else if (mediumCount === 0) {
    console.log(`  B. NO MEDIUM VARIANT. AMPRE holds ${usableCount} displayable photo(s), but none at`);
    console.log("     ImageSizeDescription='Medium' — the only size the old ETL asked for, so the");
    console.log('     listing was stored as a false-empty. The size fallback in mediaEnrichment.ts');
    console.log('     now covers this; re-run the nightly sync (or backfillMedia.ts) to recover it.');
  } else {
    console.log(`  C. NEVER RECONCILED. AMPRE holds ${mediumCount} Medium photo(s) that we simply never`);
    console.log('     fetched — a photos-only update bumps PhotosChangeTimestamp, not');
    console.log("     ModificationTimestamp, so Query A's cursor never revisits the listing. Recovery is");
    console.log('     the nightly Query A2 sweep (reconcileMissingMedia) reaching this key.');
  }

  if (soldPhotos.length > 0 && storedUrls.length === 0) {
    console.log(`\n  ℹ️  ${soldPhotos.length} photo(s) exist in raw_vow_sold.photos; getListingDetail recovers`);
    console.log('     those only when the resolved status is "sold".');
  }

  console.log('');
  process.exit(0);
})().catch((err) => {
  console.error('❌', err);
  process.exit(1);
});
