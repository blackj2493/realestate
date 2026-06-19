// Scratch: rotate the leaked Typesense SEARCH-ONLY key (audit CRITICAL-7/HIGH-14 follow-up).
// 1. Lists existing keys (masked prefixes) so we can identify the old leaked key by its
//    value_prefix (the leaked key started with "BzXk").
// 2. Creates a NEW search-only key (documents:search on all collections — parity with the
//    old key's read-only scope; never touches the admin key).
// 3. Writes it into .env (NEXT_PUBLIC_TYPESENSE_SEARCH_ONLY_API_KEY=...) and copies it to
//    the Windows clipboard for the Railway paste. The full value is NEVER printed.
// Deletion of the old key happens LATER (separate --revoke <id> run) once Railway has
// redeployed with the new key — deleting first would break prod search.
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import Typesense from 'typesense';

const HOST = '9uyapwh6e5qmvl34p-1.a1.typesense.net';
const ADMIN_KEY = process.env.TYPESENSE_ADMIN_API_KEY || '';
const ENV_PATH = '.env';
const VAR_NAME = 'NEXT_PUBLIC_TYPESENSE_SEARCH_ONLY_API_KEY';
const REVOKE_ID = (() => {
  const i = process.argv.indexOf('--revoke');
  return i >= 0 ? process.argv[i + 1] : null;
})();

const ts = new Typesense.Client({
  nodes: [{ host: HOST, port: 443, protocol: 'https' }],
  apiKey: ADMIN_KEY,
  connectionTimeoutSeconds: 30,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = any;

async function listKeys() {
  const res: AnyObj = await ts.keys().retrieve();
  console.log('Existing keys:');
  for (const k of res.keys ?? []) {
    console.log(
      `  id=${k.id}  prefix=${k.value_prefix}…  actions=${JSON.stringify(k.actions)}  collections=${JSON.stringify(k.collections)}  desc="${k.description}"`
    );
  }
  return res.keys ?? [];
}

async function main() {
  if (!ADMIN_KEY) throw new Error('TYPESENSE_ADMIN_API_KEY not set');

  if (REVOKE_ID) {
    await ts.keys(Number(REVOKE_ID)).delete();
    console.log(`✅ Revoked key id=${REVOKE_ID}. Old bundles/leaked copies now get 401.`);
    await listKeys();
    return;
  }

  await listKeys();

  const created: AnyObj = await ts.keys().create({
    description: `Public search-only key — properties ONLY (rotation final 2026-06-11, replaces leaked BzXk… key)`,
    actions: ['documents:search'],
    collections: ['properties'], // browser key needs nothing else — tightest scope
  });
  const value: string = created.value;
  console.log(`\n✅ New search-only key created: id=${created.id}  prefix=${value.slice(0, 4)}… (value NOT printed)`);

  // Update .env in place
  if (!existsSync(ENV_PATH)) throw new Error('.env not found');
  const env = readFileSync(ENV_PATH, 'utf8');
  const re = new RegExp(`^${VAR_NAME}=.*$`, 'm');
  if (!re.test(env)) throw new Error(`${VAR_NAME} line not found in .env`);
  writeFileSync(ENV_PATH, env.replace(re, `${VAR_NAME}=${value}`), 'utf8');
  console.log(`✅ .env updated (${VAR_NAME}).`);

  // Clipboard for the Railway paste (key is alphanumeric — safe to pass as argument)
  execFileSync('powershell', ['-NoProfile', '-Command', `Set-Clipboard -Value '${value}'`]);
  console.log('✅ New key copied to clipboard — paste it into Railway → Variables → ' + VAR_NAME);
  console.log('\nNEXT: update Railway, redeploy, verify prod search, then run:');
  console.log('  npx tsx scripts/admin/_rotateSearchKey.ts --revoke <id-of-the-BzXk-key>');
}

main().catch((e) => {
  console.error('❌ Failed:', e?.message || e);
  process.exit(1);
});
