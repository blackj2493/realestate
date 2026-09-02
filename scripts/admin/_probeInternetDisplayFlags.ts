/**
 * One-off probe: did the seller's "Distribute to Internet" opt-out actually reach us?
 *
 * Context: an owner (MLS# C13661766 / C13010562 / C12736862) asked for their listing
 * content to be removed and their listing agent says the MLS flag is now set to No.
 * We cannot honour that request by hand — IDX/VOW §6.3(f) forbids altering an
 * individual listing's content, and §6.3(h)'s 24h refresh would undo any manual
 * delete on the next sync. The only lawful lever is the feed's own opt-out fields:
 *
 *   InternetEntireListingDisplayYN  "Distribute to Internet"      (idx-payload.md:131)
 *   InternetAddressDisplayYN        "Display Address on Internet" (idx-payload.md:130)
 *
 * Neither field is read anywhere in this codebase today, so this probe answers only
 * the first question — "did the agent do it, and has it reached our vault?" — not
 * "is the listing gone", which it cannot be until the suppression path is built.
 *
 * Reads only. Reports, per key:
 *   1. Supabase `listings.full_payload` — the flags as the feed last transmitted them
 *      (stripStoredMedia keeps everything but `media`, so they are present if sent).
 *   2. Supabase `raw_vow_sold` — whether the key is in the append-only sold vault.
 *   3. Typesense `properties` — whether a doc is still live, and on which surface.
 *
 * Run: npx tsx scripts/admin/_probeInternetDisplayFlags.ts
 */
import 'dotenv/config';
import Typesense from 'typesense';
import { createClient } from '@supabase/supabase-js';

const KEYS = ['C13661766', 'C13010562', 'C12736862'];
const TYPESENSE_HOST = '9uyapwh6e5qmvl34p-1.a1.typesense.net';

/** The feed sends these as booleans, but dirty payloads also carry 'Y'/'N'/'true'.
 *  Report the raw value verbatim — do NOT coerce, because `undefined` (field never
 *  transmitted) and `false` (seller opted out) mean completely different things here. */
function describeFlag(v: unknown): string {
  if (v === undefined) return 'ABSENT (feed never sent this field)';
  if (v === null) return 'null';
  return `${JSON.stringify(v)} (${typeof v})`;
}

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const ts = new Typesense.Client({
    nodes: [{ host: TYPESENSE_HOST, port: 443, protocol: 'https' }],
    apiKey: process.env.TYPESENSE_ADMIN_API_KEY!,
    connectionTimeoutSeconds: 60,
  });

  for (const key of KEYS) {
    console.log(`\n${'='.repeat(70)}\n${key}\n${'='.repeat(70)}`);

    // 1. Vault payload — the authoritative record of what the feed last told us.
    const { data: row, error } = await supabase
      .from('listings')
      .select('listing_key, unparsed_address, status, full_payload, updated_at')
      .eq('listing_key', key)
      .maybeSingle();

    if (error) {
      console.log(`  listings: QUERY ERROR — ${error.message}`);
    } else if (!row) {
      console.log('  listings: no vault row (never ingested, or purged)');
    } else {
      const p = (row.full_payload ?? {}) as Record<string, unknown>;
      console.log(`  address:              ${row.unparsed_address ?? '(none)'}`);
      console.log(`  vault status:         ${row.status ?? '(none)'}`);
      console.log(`  vault updated_at:     ${row.updated_at ?? '(none)'}`);
      console.log(`  StandardStatus:       ${p.StandardStatus ?? '(none)'}`);
      console.log(`  MlsStatus:            ${p.MlsStatus ?? '(none)'}`);
      console.log(`  ModificationTimestamp:${p.ModificationTimestamp ?? '(none)'}`);
      console.log(`  >> InternetEntireListingDisplayYN: ${describeFlag(p.InternetEntireListingDisplayYN)}`);
      console.log(`  >> InternetAddressDisplayYN:       ${describeFlag(p.InternetAddressDisplayYN)}`);
      console.log(`  >> PictureYN:                      ${describeFlag(p.PictureYN)}`);
    }

    // 2. Sold vault (append-only per CLAUDE.md §12 — nothing removes from it today).
    const { data: sold } = await supabase
      .from('raw_vow_sold')
      .select('listing_key, close_date, close_price')
      .eq('listing_key', key)
      .maybeSingle();
    console.log(
      `  raw_vow_sold:         ${sold ? `PRESENT (closed ${sold.close_date}, $${sold.close_price})` : 'absent'}`
    );

    // 3. Live search index — what a user can actually still see.
    try {
      const doc: any = await ts.collections('properties').documents(key).retrieve();
      console.log(
        `  Typesense doc:        LIVE — Status=${doc.Status} TransactionType=${doc.TransactionType} ` +
          `photos=${Array.isArray(doc.mediaUrls) ? doc.mediaUrls.length : 0}`
      );
    } catch {
      console.log('  Typesense doc:        not in index');
    }
  }

  console.log(
    `\nNOTE: a "false" flag above confirms the agent's change reached our feed. It does ` +
      `NOT mean the listing is suppressed — no code reads these fields yet.\n`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
