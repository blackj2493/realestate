// READ-ONLY compliance verification (audit). Does NOT create/delete/modify anything.
// 1. Lists all Typesense API keys (masked prefix + scope only; full values never printed).
// 2. Confirms the current prod public search key's scope.
// 3. Live-tests whether the PUBLIC search key can reach the VOW `sold_listings` collection.
import 'dotenv/config';
import Typesense from 'typesense';

const HOST = '9uyapwh6e5qmvl34p-1.a1.typesense.net';
const ADMIN_KEY = process.env.TYPESENSE_ADMIN_API_KEY || '';
const SEARCH_KEY = process.env.NEXT_PUBLIC_TYPESENSE_SEARCH_ONLY_API_KEY || '';

const admin = new Typesense.Client({
  nodes: [{ host: HOST, port: 443, protocol: 'https' }],
  apiKey: ADMIN_KEY,
  connectionTimeoutSeconds: 30,
});
const search = new Typesense.Client({
  nodes: [{ host: HOST, port: 443, protocol: 'https' }],
  apiKey: SEARCH_KEY,
  connectionTimeoutSeconds: 30,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = any;

async function main() {
  if (!ADMIN_KEY) throw new Error('TYPESENSE_ADMIN_API_KEY not set');
  console.log(`Prod public search key prefix = ${SEARCH_KEY.slice(0, 4)}… (len ${SEARCH_KEY.length})\n`);

  // 1. Enumerate keys
  const res: AnyObj = await admin.keys().retrieve();
  console.log(`=== API KEYS ON CLUSTER (${(res.keys ?? []).length}) ===`);
  let leakedPresent = false;
  for (const k of res.keys ?? []) {
    if (String(k.value_prefix).startsWith('BzXk')) leakedPresent = true;
    console.log(
      `  id=${k.id}  prefix=${k.value_prefix}…  actions=${JSON.stringify(k.actions)}  collections=${JSON.stringify(k.collections)}  expires=${k.expires_at}  desc="${k.description}"`
    );
  }
  console.log(`\nLeaked BzXk… key still present? ${leakedPresent ? 'YES — NOT REVOKED (CRITICAL)' : 'no (revoked/absent)'}`);

  // 2. List collections (admin) so we know what exists
  const cols: AnyObj = await admin.collections().retrieve();
  console.log(`\n=== COLLECTIONS ===`);
  for (const c of cols) console.log(`  ${c.name}  (${c.num_documents} docs)`);

  // 3. Live test: can the PUBLIC search key read sold_listings (VOW) and properties?
  async function trySearch(collection: string) {
    try {
      const r: AnyObj = await search.collections(collection).documents().search({ q: '*', query_by: '', per_page: 1 } as AnyObj);
      return `ALLOWED — found=${r.found}${r.hits?.[0]?.document ? `, sample keys=[${Object.keys(r.hits[0].document).slice(0, 8).join(',')}]` : ''}`;
    } catch (e: AnyObj) {
      return `BLOCKED — ${e?.httpStatus || ''} ${e?.message?.slice(0, 120) || e}`;
    }
  }
  console.log(`\n=== PUBLIC SEARCH KEY (${SEARCH_KEY.slice(0, 4)}…) ACCESS TEST ===`);
  console.log(`  properties     -> ${await trySearch('properties')}`);
  console.log(`  sold_listings  -> ${await trySearch('sold_listings')}`);

  // 4. Can the public key page past the intended 100-cap? (per_page=250 is Typesense max)
  try {
    const r: AnyObj = await search.collections('properties').documents().search({ q: '*', query_by: '', per_page: 250, page: 2 } as AnyObj);
    console.log(`\n  per_page=250 page=2 on properties via public key -> ALLOWED (returned ${r.hits?.length} hits, found=${r.found}) — key does NOT enforce the 100 cap`);
  } catch (e: AnyObj) {
    console.log(`\n  per_page=250 page=2 via public key -> BLOCKED ${e?.httpStatus || ''} ${e?.message?.slice(0, 100)}`);
  }
}

main().catch((e) => { console.error('FAILED:', e?.message || e); process.exit(1); });
