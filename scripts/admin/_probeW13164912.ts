/**
 * One-off probe: why does W13164912 (2663 Widemarr Rd, Mississauga) still show
 * as For Sale when it has sold?
 *
 * Checks:
 *  1. Typesense `properties` doc — Status / TransactionType / ModificationTimestamp
 *  2. Supabase `raw_vow_sold` — sold record (purchase_contract_date, close_price, mls_status)
 *  3. Supabase `listings` vault row — last known payload status
 *
 * Run: npx.cmd tsx scripts/admin/_probeW13164912.ts
 */
import 'dotenv/config';
import Typesense from 'typesense';
import { createClient } from '@supabase/supabase-js';

const KEY = 'W13164912';
const TYPESENSE_HOST = '9uyapwh6e5qmvl34p-1.a1.typesense.net';

async function main() {
  const ts = new Typesense.Client({
    nodes: [{ host: TYPESENSE_HOST, port: 443, protocol: 'https' }],
    apiKey: process.env.TYPESENSE_ADMIN_API_KEY!,
    connectionTimeoutSeconds: 60,
  });

  console.log('=== 1. Typesense `properties` doc ===');
  try {
    const doc: any = await ts.collections('properties').documents(KEY).retrieve();
    const pick = (o: any, keys: string[]) =>
      Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));
    console.log(
      JSON.stringify(
        pick(doc, [
          'id', 'ListingKey', 'Status', 'StandardStatus', 'MlsStatus', 'TransactionType',
          'ListPrice', 'ModificationTimestamp', 'OriginalEntryTimestamp', 'UnparsedAddress',
          'DaysOnMarket', 'true_dom',
        ]),
        null,
        2
      )
    );
  } catch (e: any) {
    console.log(`not found / error: ${e?.message || e}`);
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  console.log('\n=== 2. raw_vow_sold record ===');
  const { data: sold, error: soldErr } = await supabase
    .from('raw_vow_sold')
    .select('*')
    .eq('listing_key', KEY);
  if (soldErr) console.log(`error: ${soldErr.message}`);
  else
    console.log(
      JSON.stringify(
        (sold ?? []).map(({ raw_payload, full_payload, ...rest }: any) => ({
          ...rest,
          raw_payload_status: raw_payload?.MlsStatus ?? raw_payload?.StandardStatus,
        })),
        null,
        2
      )
    );

  console.log('\n=== 3. listings vault row ===');
  const { data: vault, error: vaultErr } = await supabase
    .from('listings')
    .select('*')
    .eq('listing_key', KEY);
  if (vaultErr) console.log(`error: ${vaultErr.message}`);
  else
    console.log(
      JSON.stringify(
        (vault ?? []).map(({ full_payload, raw_payload, ...rest }: any) => ({
          ...rest,
          payload_standard_status: (full_payload ?? raw_payload)?.StandardStatus,
          payload_mls_status: (full_payload ?? raw_payload)?.MlsStatus,
          payload_mod_ts: (full_payload ?? raw_payload)?.ModificationTimestamp,
        })),
        null,
        2
      )
    );

  console.log('\n=== 4. sold_listings Typesense doc ===');
  try {
    const sdoc: any = await ts.collections('sold_listings').documents(KEY).retrieve();
    console.log(JSON.stringify(sdoc, null, 2));
  } catch (e: any) {
    console.log(`not found / error: ${e?.message || e}`);
  }
}

main().catch((e) => {
  console.error('probe failed:', e?.message || e);
  process.exit(1);
});
