import { Client } from 'pg';
import { writeFileSync } from 'fs';
import dotenv from 'dotenv';
dotenv.config({ path: ['.env.local', '.env'] });

const OUT = process.argv[2];
if (!OUT) { console.error('usage: genmig <outfile>'); process.exit(1); }

const HEADER = `-- 106: region-metrics RPCs — exclude leases by transaction_type, not by price.
--
-- Final pass of the proxy-threshold audit (PRs #217, #218, #219). These five
-- functions each carried \`close_price >= 50000\`, a magnitude test standing in for
-- "this row is a sale". raw_vow_sold mixes SOLD rows with LEASED ones whose
-- close_price is a monthly rent.
--
-- The migration FILES are not a reliable source here: the proxy appears 18 times
-- across 15 of them and later migrations supersede earlier ones (097 replaces
-- 065/066, 089 replaces 040/059). Only five functions are actually live. These
-- bodies were therefore generated from pg_get_functiondef() with a single
-- mechanical substitution, so nothing is transcribed by hand and no unrelated
-- drift can creep in.
--
-- THE PRICE FLOOR IS DELIBERATELY KEPT.
-- For the AVM (#219) the floor was dropped to 1, because comps are already
-- narrowed by property_sub_type and more of them is better. These functions
-- publish market medians on /analytics, so the floor keeps its OTHER job —
-- keeping $1 placeholders and sub-$50k land out of a headline "median sale
-- price" — and the change here is purely defensive: it removes the assumption
-- that no lease will ever close above $50k. Outputs are unchanged today, and the
-- verification asserts exactly that.
--
-- ALLOWLIST, NOT DENYLIST — and deliberately the opposite of #217.
-- The search typeahead negates ("anything that is not a sale gets the lenient
-- floor") because its job is to make everything findable: an unrecognised
-- transaction type should still surface. These compute money statistics, so an
-- unrecognised type must be EXCLUDED until someone looks at it. Default toward
-- including for discovery, toward excluding for computation.
-- (region_listing_outcomes' de-listed branch uses NOT LIKE '%lease%' for its own
-- reasons; that branch is untouched here.)
--
-- Regenerate with: scripts/admin/regenRegionRpcMigration.ts
`;

const NEEDLE = 'close_price >= 50000';
const REPLACEMENT = "transaction_type = 'For Sale'\n      AND close_price >= 50000";

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  await c.query("SET statement_timeout TO '300s'");

  const { rows } = await c.query(`
    WITH defs AS MATERIALIZED (
      SELECT p.oid, p.proname,
             pg_get_function_identity_arguments(p.oid) AS args,
             pg_get_functiondef(p.oid) AS def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.prokind = 'f'
    )
    SELECT proname, args, def FROM defs
    WHERE def LIKE '%${NEEDLE}%' ORDER BY proname`);

  const parts: string[] = [HEADER];
  for (const r of rows) {
    const def: string = r.def;
    const hits = def.split(NEEDLE).length - 1;
    if (hits !== 1) throw new Error(`${r.proname}: expected 1 occurrence, found ${hits}`);
    if (def.includes("transaction_type = 'For Sale'")) {
      throw new Error(`${r.proname}: already filtered — refusing to double-apply`);
    }
    const next = def.replace(NEEDLE, REPLACEMENT);
    if (next === def) throw new Error(`${r.proname}: substitution made no change`);

    parts.push(`\n-- ---------------------------------------------------------------------------\n-- ${r.proname}(${r.args})\n-- ---------------------------------------------------------------------------\n${next.trimEnd()};\n`);
    console.log(`  ✅ ${r.proname} — ${def.length} -> ${next.length} chars`);
  }

  if (rows.length === 0) throw new Error('no functions matched — nothing to generate');
  writeFileSync(OUT, parts.join('\n'), 'utf8');
  console.log(`\nWrote ${rows.length} function(s) to ${OUT}`);
  await c.end();
})().catch((e) => { console.error('❌', e.message); process.exit(1); });
