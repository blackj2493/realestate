/**
 * Probe: does the AMPRE OData /Property endpoint support $expand=Media?
 *
 * Hits a tiny single-record query against the live feed and reports whether
 * the response carries an inline Media array. No DB writes, no sync_state
 * mutation, no Typesense calls — read-only diagnostic.
 *
 * Usage: npx tsx scripts/admin/probeExpandMedia.ts [ListingKey]
 *   default ListingKey: W13133990 (the sold record the user previously checked)
 */
import 'dotenv/config';

const API_BASE_URL = process.env.AMPRE_API_URL || 'https://query.ampre.ca/odata';
const ID = process.argv[2] || 'W13133990';

async function probe(token: string, label: string) {
  const filter = `ListingKey eq '${ID}'`;
  const url = `${API_BASE_URL}/Property?$filter=${encodeURIComponent(filter)}&$expand=Media&$top=1`;
  console.log(`\n[${label}] ${url}`);

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  console.log(`  HTTP ${res.status}`);
  if (!res.ok) {
    console.log(`  body: ${(await res.text()).slice(0, 400)}`);
    return;
  }
  const data = await res.json();
  const rec = (data.value || [])[0];
  if (!rec) {
    console.log('  no record returned (token may not have access to this status)');
    return;
  }
  console.log(`  status: ${rec.StandardStatus} / mls: ${rec.MlsStatus}`);
  const inlineMedia = (rec as any).Media;
  const lowerMedia = (rec as any).media;
  console.log(`  Media (capitalized) len: ${Array.isArray(inlineMedia) ? inlineMedia.length : '(absent)'}`);
  console.log(`  media (lowercase)   len: ${Array.isArray(lowerMedia) ? lowerMedia.length : '(absent)'}`);
  const sample = inlineMedia?.[0] ?? lowerMedia?.[0];
  if (sample) {
    console.log(`  sample: ${JSON.stringify(sample).slice(0, 300)}`);
  }
}

(async () => {
  const idx = process.env.PROPTX_IDX_TOKEN;
  const vow = process.env.PROPTX_VOW_TOKEN;
  if (!idx && !vow) {
    console.error('Neither PROPTX_IDX_TOKEN nor PROPTX_VOW_TOKEN is set');
    process.exit(1);
  }
  if (idx) await probe(idx, 'IDX');
  if (vow) await probe(vow, 'VOW');
})();
