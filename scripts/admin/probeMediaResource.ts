/**
 * Probe: does AMPRE return media records via the /Media resource for a known
 * listing, using the IDX and/or VOW token? Read-only diagnostic — no DB writes.
 *
 * Usage: npx tsx scripts/admin/probeMediaResource.ts [ListingKey]
 *   default: W13133990 (the sold record the user previously checked)
 */
import 'dotenv/config';
import { fetchMediaForKeys } from '../worker/mediaEnrichment';

const ID = process.argv[2] || 'W13133990';
const API_BASE_URL = (process.env.AMPRE_API_URL || 'https://query.ampre.ca/odata').trim();

async function rawCountBySize(token: string, size: string): Promise<number> {
  const filter = `ResourceRecordKey eq '${ID}' and ResourceName eq 'Property' and ImageSizeDescription eq '${size}'`;
  const url = `${API_BASE_URL}/Media?$filter=${encodeURIComponent(filter)}&$top=1&$count=true`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  if (!res.ok) return -1;
  const data = await res.json();
  return data['@odata.count'] ?? -1;
}

(async () => {
  const idx = (process.env.PROPTX_IDX_TOKEN || '').trim();
  const vow = (process.env.PROPTX_VOW_TOKEN || '').trim();
  if (!idx && !vow) {
    console.error('Neither PROPTX_IDX_TOKEN nor PROPTX_VOW_TOKEN is set');
    process.exit(1);
  }
  for (const [label, token] of [['IDX', idx], ['VOW', vow]] as const) {
    if (!token) {
      console.log(`\n[${label}] (no token)`);
      continue;
    }
    console.log(`\n[${label}] fetching /Media for ${ID} ...`);
    const { media: map } = await fetchMediaForKeys([ID], token);
    const arr = map.get(ID) || [];
    console.log(`  records: ${arr.length}`);
    const objectIds = new Set(arr.map((m) => m.MediaObjectID).filter(Boolean));
    const keys = new Set(arr.map((m) => m.MediaKey).filter(Boolean));
    console.log(`  unique MediaObjectID: ${objectIds.size}`);
    console.log(`  unique MediaKey     : ${keys.size}`);
    const sizes = new Set(arr.map((m) => m.ImageSizeDescription).filter(Boolean));
    console.log(`  sizes               : ${[...sizes].join(', ')}`);
    // Look at first two records to see if they're the same logical photo at different sizes
    if (arr[0] && arr[1]) {
      console.log(`  rec 0: size=${arr[0].ImageSizeDescription} objId=${arr[0].MediaObjectID} key=${arr[0].MediaKey} order=${arr[0].Order}`);
      console.log(`  rec 1: size=${arr[1].ImageSizeDescription} objId=${arr[1].MediaObjectID} key=${arr[1].MediaKey} order=${arr[1].Order}`);
    }
    // Raw server-side counts per size (post-dedup is what we display; raw is what the API actually has).
    const sizesToCheck = ['Thumbnail', 'Medium', 'Large', 'Largest', 'LargestNoWatermark'];
    console.log('  raw counts on /Media:');
    for (const s of sizesToCheck) {
      const n = await rawCountBySize(token, s);
      console.log(`    ${s.padEnd(20)} : ${n}`);
    }
  }
})();
