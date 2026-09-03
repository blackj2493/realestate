/**
 * Decision probe for the ledger thumbnail fix.
 *
 * The terminal ledger renders a 144x112 card from `primaryImageUrl`, and 100% of a
 * 1,250-doc sample of the live `properties` index carries the `rs:fit:960:960` variant
 * (median ~132 KB, mean ~140 KB). That is ~44x the pixels the card needs, and Next.js
 * already flags it as the Largest Contentful Paint element on /properties.
 *
 * The size is inside the imgproxy SIGNATURE, so the URL cannot be rewritten to a smaller
 * variant — a hand-edited `rs:fit:288:288` returns 403. The only smaller image is a
 * SEPARATE URL that AMPRE must hand us at ImageSizeDescription='Thumbnail', and today
 * `fetchMediaForKeys` asks for 'Thumbnail' only as a last-resort fallback for listings
 * that returned nothing at Medium/Large/Largest. So no small URL exists in our data.
 *
 * Before we add a second AMPRE pass, a `thumbnailUrl` column and a ~100k-doc backfill,
 * three facts have to be measured rather than assumed:
 *
 *   1. COVERAGE  — does a 'Thumbnail' record exist for a normal listing, or only for the
 *                  odd one? A pass that finds nothing is pure cost.
 *   2. PIXELS    — the card is 144x112 CSS px, so a retina viewer wants ~288px. TRREB's
 *                  'Thumbnail' is documented as 240px, which is 1.67x — acceptable, but
 *                  it has to be checked, not inherited from a code comment. (The comment
 *                  in LedgerRow.tsx already claims the source IS the ~240px variant, and
 *                  production says otherwise, so comments are not evidence here.)
 *   3. BYTES     — the whole point. Measure the real transfer size of both variants.
 *
 * Read-only. Hits AMPRE /Media and does a byte-range-free GET of two images per listing.
 *
 * Run: npx.cmd tsx scripts/admin/_probeMediaSizeVariants.ts [sampleSize]
 *
 * NOTE ON CREDENTIALS: every PROPTX and AMPRE token in the local .env returned HTTP 403
 * against both /Property and /Media from a developer machine on 2026-09-02, while the
 * same queries run fine from the scheduled GitHub Actions sync. If this probe 403s for
 * you too, run it from a workflow rather than assuming the tokens are dead.
 */
import 'dotenv/config';

const API_BASE_URL = (process.env.AMPRE_API_URL || 'https://query.ampre.ca/odata').trim();
const TOKEN = (process.env.PROPTX_IDX_TOKEN || '').trim();
const TYPESENSE_HOST = '9uyapwh6e5qmvl34p-1.a1.typesense.net';

/** The sizes the ETL knows about, best-fit first. Mirrors SIZE_PREFERENCE. */
const SIZES = ['Medium', 'Large', 'Largest', 'Thumbnail'] as const;
type Size = (typeof SIZES)[number];

interface MediaRecord {
  MediaURL?: string;
  MediaStatus?: string;
  Order?: number;
  ImageSizeDescription?: string;
  ResourceRecordKey?: string;
}

/** JPEG SOF marker walk — pixel dimensions without decoding the image. */
function jpegSize(buf: Buffer): { w: number; h: number } | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = buf[i + 1];
    // SOF0..SOF15, skipping the non-frame markers DHT(c4) / JPGA(c8) / DAC(cc).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    }
    const len = buf.readUInt16BE(i + 2);
    if (len < 2) return null;
    i += 2 + len;
  }
  return null;
}

/** Live listing keys straight from the index the ledger actually reads. */
async function sampleListingKeys(n: number): Promise<string[]> {
  const key = process.env.NEXT_PUBLIC_TYPESENSE_SEARCH_ONLY_API_KEY || '';
  if (!key) throw new Error('NEXT_PUBLIC_TYPESENSE_SEARCH_ONLY_API_KEY is not set');
  const params = new URLSearchParams({
    'x-typesense-api-key': key,
    q: '*',
    query_by: 'City',
    per_page: String(Math.min(n, 250)),
    include_fields: 'id,primaryImageUrl',
    filter_by: 'TransactionType:=`For Sale`',
  });
  const res = await fetch(`https://${TYPESENSE_HOST}/collections/properties/documents/search?${params}`);
  if (!res.ok) throw new Error(`Typesense sample failed: ${res.status}`);
  const body = (await res.json()) as { hits?: { document: { id: string } }[] };
  return (body.hits ?? []).map((h) => h.document.id);
}

/** Every /Media record for these keys at ONE size. Mirrors fetchChunkAtSize's shape. */
async function mediaAtSize(keys: string[], size: Size): Promise<MediaRecord[]> {
  const keyFilter = `(${keys.map((k) => `ResourceRecordKey eq '${k}'`).join(' or ')})`;
  const filter = `${keyFilter} and ResourceName eq 'Property' and ImageSizeDescription eq '${size}'`;
  const out: MediaRecord[] = [];
  for (let skip = 0; ; skip += 100) {
    const url =
      `${API_BASE_URL}/Media?$filter=${encodeURIComponent(filter)}` +
      `&$orderby=ResourceRecordKey,Order&$top=100&$skip=${skip}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
    if (!res.ok) throw new Error(`/Media ${size} → HTTP ${res.status}`);
    const body = (await res.json()) as { value?: MediaRecord[] };
    const rows = body.value ?? [];
    out.push(...rows);
    if (rows.length < 100) break;
  }
  return out;
}

/** Real transfer size + decoded pixels for one image URL. */
async function measure(url: string): Promise<{ bytes: number; w: number; h: number } | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  const dim = jpegSize(buf);
  return { bytes: buf.length, w: dim?.w ?? 0, h: dim?.h ?? 0 };
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

async function main() {
  const sampleSize = Number(process.argv[2] || 40);
  if (!TOKEN) throw new Error('PROPTX_IDX_TOKEN is not set');

  const keys = await sampleListingKeys(sampleSize);
  console.log(`Sampled ${keys.length} live For Sale listings from Typesense.\n`);

  // 1) COVERAGE — one /Media call per size across the whole sample.
  const byKeySize = new Map<Size, Map<string, MediaRecord>>();
  for (const size of SIZES) {
    const rows = await mediaAtSize(keys, size);
    // Lowest Order per listing = the cover photo the ETL would pick at this size.
    const best = new Map<string, MediaRecord>();
    for (const r of rows) {
      const k = r.ResourceRecordKey;
      if (!k || !r.MediaURL || r.MediaStatus === 'Deleted') continue;
      const prev = best.get(k);
      if (!prev || (r.Order ?? Infinity) < (prev.Order ?? Infinity)) best.set(k, r);
    }
    byKeySize.set(size, best);
    const pct = ((best.size / keys.length) * 100).toFixed(1);
    console.log(`  ${size.padEnd(10)} present on ${String(best.size).padStart(3)}/${keys.length} listings (${pct}%)`);
  }

  // 2) + 3) PIXELS and BYTES — Medium (what we ship) vs Thumbnail (the candidate).
  const medium = byKeySize.get('Medium')!;
  const thumb = byKeySize.get('Thumbnail')!;
  const both = keys.filter((k) => medium.has(k) && thumb.has(k));
  console.log(`\nBoth variants available on ${both.length}/${keys.length} listings.`);
  if (both.length === 0) {
    console.log('No listing carries both — a Thumbnail pass would not help. STOP HERE.');
    return;
  }

  const mB: number[] = [];
  const tB: number[] = [];
  let mDim = '';
  let tDim = '';
  for (const k of both.slice(0, 15)) {
    const m = await measure(medium.get(k)!.MediaURL!);
    const t = await measure(thumb.get(k)!.MediaURL!);
    if (!m || !t) continue;
    mB.push(m.bytes);
    tB.push(t.bytes);
    mDim = `${m.w}x${m.h}`;
    tDim = `${t.w}x${t.h}`;
  }

  console.log(`\n  Medium    ${mDim.padEnd(10)} median ${(median(mB) / 1024).toFixed(0)} KB`);
  console.log(`  Thumbnail ${tDim.padEnd(10)} median ${(median(tB) / 1024).toFixed(0)} KB`);
  console.log(`\n  Saving per ledger row: ${((1 - median(tB) / Math.max(median(mB), 1)) * 100).toFixed(0)}%`);
  console.log(`  100-row ledger: ${((median(mB) * 100) / 1024 / 1024).toFixed(1)} MB → ${((median(tB) * 100) / 1024 / 1024).toFixed(1)} MB`);
  console.log(`\n  Card is 144x112 CSS px; a 2x viewer wants ~288px on the long edge.`);
  console.log(`  Thumbnail long edge = ${Math.max(...tDim.split('x').map(Number))}px.`);
}

main().catch((e) => {
  console.error('❌', e instanceof Error ? e.message : e);
  process.exit(1);
});
