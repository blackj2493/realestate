/** One-off: is the FULL postal code in raw_vow_sold.raw_payload even when the scalar
 *  postal_code column is truncated to FSA? Read-only. */
import { createClient } from '@supabase/supabase-js';
const sb = createClient((process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim(), (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim(), { auth: { persistSession: false } });
function mask(p: string): string { const r = (p || '').replace(/\s+/g, ''); return r.length === 6 ? r.slice(0, 3) + ' ' + r[3] + 'X' + r[5] : r; }
async function main() {
  const { data, error } = await sb.from('raw_vow_sold').select('listing_key, postal_code, raw_payload').gte('close_price', 50000).limit(2500);
  if (error) { console.error(error.message); process.exit(1); }
  const rows = (data ?? []) as Array<{ listing_key: string; postal_code: string | null; raw_payload: Record<string, unknown> | null }>;
  // Find candidate postal fields in the payload.
  const fieldCounts = new Map<string, number>();
  let colFsaPayloadFull = 0, colFull = 0, n = 0, payloadFullPresent = 0;
  const examples: string[] = [];
  for (const r of rows) {
    n++;
    const p = r.raw_payload || {};
    const candidates = Object.keys(p).filter((k) => /postal/i.test(k));
    for (const k of candidates) fieldCounts.set(k, (fieldCounts.get(k) ?? 0) + 1);
    const colLen = (r.postal_code || '').replace(/\s+/g, '').length;
    if (colLen === 6) colFull++;
    // Pull payload PostalCode (RESO field).
    const payVal = String((p['PostalCode'] ?? p['UnparsedPostalCode'] ?? '') || '').replace(/\s+/g, '');
    if (payVal.length === 6) {
      payloadFullPresent++;
      if (colLen === 3 && examples.length < 8) examples.push(`col=${r.postal_code} payload=${mask(payVal)}`);
      if (colLen === 3) colFsaPayloadFull++;
    }
  }
  console.log(`sampled ${n} rows`);
  console.log('payload keys matching /postal/:', [...fieldCounts.entries()].map(([k, c]) => `${k}(${c})`).join(', ') || 'NONE');
  console.log(`scalar postal_code is 6-char: ${colFull}/${n}`);
  console.log(`payload PostalCode is 6-char (full): ${payloadFullPresent}/${n}`);
  console.log(`>>> rows where COLUMN=FSA(3) but PAYLOAD has full 6-char: ${colFsaPayloadFull}/${n}`);
  console.log('examples (col vs masked payload):', examples.join(' | ') || 'none');
}
main().catch((e) => { console.error(e?.message || e); process.exit(1); });
