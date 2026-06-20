/** READ-ONLY diagnostic: why does region_active_aggregates('Toronto', beds floor) 500? */
import { Client } from 'pg';
import dotenv from 'dotenv';
dotenv.config({ path: ['.env.local', '.env'] });
const url = process.env.DATABASE_URL || process.env.DIRECT_DB_URL;
if (!url) { console.error('no db url'); process.exit(1); }

async function main() {
  const c = new Client({ connectionString: url, connectionTimeoutMillis: 15000 });
  await c.connect();
  try {
    // 1. Reproduce the failing call (beds floor on Toronto), capture the PG error.
    for (const [label, args] of [
      ['Toronto beds>=3 any',        `'Toronto', NULL, 3, 0,0,0, 'any'`],
      ['Mississauga beds>=3 any',    `'Mississauga', NULL, 3, 0,0,0, 'any'`],
      ['Toronto beds=0 any (base)',  `'Toronto', NULL, 0, 0,0,0, 'any'`],
    ] as const) {
      const t0 = Date.now();
      try {
        const r = await c.query(`SELECT * FROM region_active_aggregates(${args})`);
        console.log(`✅ ${label}: ${JSON.stringify(r.rows[0])}  (${Date.now() - t0}ms)`);
      } catch (e: unknown) {
        console.log(`❌ ${label}: ${(e as Error).message}  (${Date.now() - t0}ms)`);
      }
    }
    // 2. Non-numeric BedroomsTotal among Toronto active rows (would break ::numeric).
    const bad = await c.query(`
      SELECT full_payload->>'BedroomsTotal' AS bt, count(*) AS n
      FROM listings
      WHERE (
        lower(city) >= 'toronto ' AND lower(city) < 'toronto' || chr(33)
        AND lower(city) ~ '^toronto [cwe][0-9][0-9]$'
      )
      AND list_price >= 50000
      AND full_payload->>'BedroomsTotal' IS NOT NULL
      AND NULLIF(full_payload->>'BedroomsTotal','') !~ '^[0-9]+(\\.[0-9]+)?$'
      GROUP BY 1 ORDER BY n DESC LIMIT 20`);
    console.log('\nNon-numeric Toronto BedroomsTotal values:', JSON.stringify(bad.rows));

    // 3. Same check for the other numeric-cast fields used under a floor.
    for (const f of ['BathroomsTotalInteger', 'ParkingTotal', 'LotWidth']) {
      const r = await c.query(`
        SELECT count(*) AS bad_rows
        FROM listings
        WHERE (lower(city) >= 'toronto ' AND lower(city) < 'toronto' || chr(33)
               AND lower(city) ~ '^toronto [cwe][0-9][0-9]$')
          AND list_price >= 50000
          AND full_payload->>'${f}' IS NOT NULL
          AND NULLIF(full_payload->>'${f}','') !~ '^[0-9]+(\\.[0-9]+)?$'`);
      console.log(`Toronto non-numeric ${f}:`, r.rows[0].bad_rows);
    }
  } finally { await c.end(); }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1); });
