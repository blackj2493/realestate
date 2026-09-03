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
 * Neither field is read anywhere in this codebase today, so this probe cannot answer
 * "is the listing gone" — it will not be until the suppression path is built.
 *
 * THE VAULT ALONE CANNOT ANSWER "DID THE AGENT DO IT". If the board stops transmitting
 * a record once the flag goes false, our `listings` row simply freezes at the last
 * payload it ever sent — still reading true/absent. That is indistinguishable from an
 * agent who did nothing. Only a live per-key feed lookup separates the two, so this
 * probe does both and prints an explicit verdict:
 *
 *   feed returns key + flag false    → CONFIRMED: the opt-out is live in the feed.
 *   feed returns key + flag true     → NOT DONE: no opt-out recorded on this key.
 *   feed returns key + flag absent   → NOT DONE (field never populated for this key).
 *   feed does not return key         → AMBIGUOUS: either the board withdrew the record
 *                                      (consistent with an opt-out) or the key is
 *                                      outside our licensed scope / never existed.
 *                                      Cannot be read as confirmation on its own.
 *
 * Reads only — no writes, no deletes. Reports, per key:
 *   1. VOW feed, live — the flags as the board serves them RIGHT NOW (the verdict).
 *   2. Supabase `listings.full_payload` — the flags as the feed last transmitted them
 *      (stripStoredMedia keeps everything but `media`, so they are present if sent).
 *   3. Supabase `raw_vow_sold` — whether the key is in the append-only sold vault.
 *   4. Typesense `properties` — whether a doc is still live, and on which surface.
 *
 * Requires PROPTX_VOW_TOKEN, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and
 * TYPESENSE_ADMIN_API_KEY in .env.local.
 *
 * Run: npx tsx scripts/admin/_probeInternetDisplayFlags.ts
 */
import 'dotenv/config';
import Typesense from 'typesense';
import { createClient } from '@supabase/supabase-js';

const KEYS = ['C13661766', 'C13010562', 'C12736862'];
const TYPESENSE_HOST = '9uyapwh6e5qmvl34p-1.a1.typesense.net';
const API_BASE_URL = process.env.AMPRE_API_URL || 'https://query.ampre.ca/odata';
const VOW_TOKEN = process.env.PROPTX_VOW_TOKEN;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Mirrors ghostReconcile.feedGet — retries transient feed errors up to 3 attempts. */
async function feedGet(url: string, token: string): Promise<any> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (res.ok) return res.json();
    if (attempt >= 3) throw new Error(`feed HTTP ${res.status}: ${url.slice(0, 120)}`);
    await sleep(1500 * attempt);
  }
}

/** Current payloads straight from VOW, or-chained (ghostReconcile.fetchCurrentPayloads). */
async function fetchCurrentPayloads(keys: string[]): Promise<Map<string, any>> {
  const filter = keys.map((k) => `ListingKey eq '${k}'`).join(' or ');
  const url = `${API_BASE_URL}/Property?$filter=${encodeURIComponent(filter)}&$top=${keys.length}`;
  const data = await feedGet(url, VOW_TOKEN!);
  const out = new Map<string, any>();
  for (const r of data.value ?? []) out.set(r.ListingKey, r);
  return out;
}

/** The whole point of the probe: turn a live feed payload into a defensible verdict. */
function verdict(live: any | undefined): string {
  if (!live) {
    return 'AMBIGUOUS — feed does not return this key. Either the board withdrew the\n' +
      '                        record (consistent with an opt-out) or it is outside our\n' +
      '                        licensed scope. NOT confirmation on its own.';
  }
  const f = live.InternetEntireListingDisplayYN;
  if (f === false || f === 'N' || f === 'false') return 'CONFIRMED — opt-out is live in the feed.';
  if (f === undefined || f === null) return 'NOT DONE — field never populated for this key.';
  return `NOT DONE — flag still ${JSON.stringify(f)}; no opt-out recorded.`;
}

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

  if (!VOW_TOKEN) {
    throw new Error(
      'PROPTX_VOW_TOKEN is not set. Without it this probe can only read our own stale ' +
        'vault, which cannot distinguish "agent did nothing" from "board withdrew the record".'
    );
  }

  // Live feed first — this is the only source that can confirm the agent's change.
  const live = await fetchCurrentPayloads(KEYS);

  for (const key of KEYS) {
    console.log(`\n${'='.repeat(70)}\n${key}\n${'='.repeat(70)}`);

    const l = live.get(key);
    console.log('  --- VOW feed, live (authoritative) ---');
    console.log(`  VERDICT:              ${verdict(l)}`);
    if (l) {
      console.log(`  feed StandardStatus:  ${l.StandardStatus ?? '(none)'} / ${l.MlsStatus ?? '(none)'}`);
      console.log(`  feed ModTimestamp:    ${l.ModificationTimestamp ?? '(none)'}`);
      console.log(`  >> InternetEntireListingDisplayYN: ${describeFlag(l.InternetEntireListingDisplayYN)}`);
      console.log(`  >> InternetAddressDisplayYN:       ${describeFlag(l.InternetAddressDisplayYN)}`);
    }

    // 1. Vault payload — what the feed last told US, which may be stale (see header).
    console.log('  --- our vault (may lag the feed) ---');
    const { data: row, error } = await supabase
      .from('listings')
      .select('listing_key, norm_address, standard_status, is_orphaned, last_seen_at, full_payload, updated_at')
      .eq('listing_key', key)
      .maybeSingle();

    if (error) {
      console.log(`  listings: QUERY ERROR — ${error.message}`);
    } else if (!row) {
      console.log('  listings: no vault row (never ingested, or purged)');
    } else {
      const p = (row.full_payload ?? {}) as Record<string, unknown>;
      console.log(`  address:              ${row.norm_address ?? '(none)'}`);
      console.log(`  vault status:         ${row.standard_status ?? '(none)'}`);
      console.log(`  vault is_orphaned:    ${row.is_orphaned ?? '(none)'}`);
      console.log(`  vault last_seen_at:   ${row.last_seen_at ?? '(none)'}`);
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

    // 3. Live search indexes — what a user can actually still see. BOTH collections:
    //    `properties` backs the terminal and the /properties page; `sold_listings` backs
    //    the public /address page (soldByKey.ts). Checking only one understates exposure.
    for (const collection of ['properties', 'sold_listings']) {
      try {
        const doc: any = await ts.collections(collection).documents(key).retrieve();
        const photos = Array.isArray(doc.mediaUrls)
          ? doc.mediaUrls.length
          : Array.isArray(doc.RawImages)
            ? doc.RawImages.length
            : 0;
        console.log(
          `  ts:${collection.padEnd(15)}  LIVE — Status=${doc.Status ?? doc.MlsStatus ?? '(none)'} ` +
            `TransactionType=${doc.TransactionType ?? '(none)'} photos=${photos}`
        );
      } catch {
        console.log(`  ts:${collection.padEnd(15)}  not in index`);
      }
    }
  }

  console.log(
    `\nNOTE: a CONFIRMED verdict means the opt-out is live in the feed. It does NOT mean ` +
      `the listing is suppressed on our site — no code reads these fields yet.\n`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
