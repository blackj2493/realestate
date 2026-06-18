/**
 * One-off probe: why do sold comps show 0 basement bedrooms?
 *
 * For each address: 1) the live `sold_listings` Typesense doc bed fields, and
 * 2) the upstream `raw_vow_sold` columns + raw_payload bedroom fields — to tell a
 * "not reindexed yet" state apart from a "source has no below-grade data" state.
 *
 * Run: npx tsx scripts/admin/_probeSoldBeds.ts
 */
import 'dotenv/config';
import Typesense from 'typesense';
import { createClient } from '@supabase/supabase-js';

const TYPESENSE_HOST = '9uyapwh6e5qmvl34p-1.a1.typesense.net';
const ADDRESSES = ['Lynda Mcneil', '234 Main', 'Royal West'];

async function main() {
  const ts = new Typesense.Client({
    nodes: [{ host: TYPESENSE_HOST, port: 443, protocol: 'https' }],
    apiKey: process.env.TYPESENSE_ADMIN_API_KEY!,
    connectionTimeoutSeconds: 60,
  });
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  for (const q of ADDRESSES) {
    console.log(`\n========== "${q}" ==========`);
    const res: any = await ts.collections('sold_listings').documents().search({
      q,
      query_by: 'UnparsedAddress',
      per_page: 3,
    });
    const hits = res.hits ?? [];
    if (hits.length === 0) {
      console.log('  (no sold_listings hit)');
      continue;
    }
    for (const h of hits) {
      const d = h.document;
      console.log(`  TS sold_listings ${d.id} — ${d.UnparsedAddress}`);
      console.log(
        `     BedroomsTotal=${d.BedroomsTotal}  AboveGrade=${d.BedroomsAboveGrade ?? '(absent)'}  BelowGrade=${d.BedroomsBelowGrade ?? '(absent)'}  CoveredSpaces=${d.CoveredSpaces ?? '(absent)'}`
      );
      const { data: rows } = await supabase
        .from('raw_vow_sold')
        .select('listing_key, bedrooms_above_grade, bedrooms_below_grade, covered_spaces, raw_payload')
        .eq('listing_key', d.id);
      const r: any = (rows ?? [])[0];
      if (!r) {
        console.log('     raw_vow_sold: (no row)');
        continue;
      }
      const p = r.raw_payload ?? {};
      console.log(
        `     raw_vow_sold cols → above_grade=${r.bedrooms_above_grade}  below_grade=${r.bedrooms_below_grade}  covered=${r.covered_spaces}`
      );
      console.log(
        `     raw_payload      → BedroomsTotal=${p.BedroomsTotal}  BedroomsAboveGrade=${p.BedroomsAboveGrade}  BedroomsBelowGrade=${p.BedroomsBelowGrade}`
      );
    }
  }
}

main().catch((e) => {
  console.error('probe failed:', e?.message || e);
  process.exit(1);
});
