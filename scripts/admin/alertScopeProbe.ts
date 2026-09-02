/**
 * READ-ONLY probe: how many new listings the nightly digest actually matches for one
 * account's saved areas, and how many it SHOULD.
 *
 * Per alerting area, over the last N days:
 *   stored-scope  what tonight's email will contain (the row's saved filter snapshot)
 *   live-lens     what it would contain under the account's CURRENT dashboard lens
 *   area-only     everything new in the area, unfiltered
 * plus whether the area is still on the dashboard at all, and any dashboard area with no
 * alert row behind it.
 *
 * It exists because the 2026-09-01 drift was invisible from either table alone: the
 * dashboard listed 2 areas, the worker delivered on 6, and the one correct area matched 1
 * listing a week instead of 4 because its "My filters only" snapshot had been frozen since
 * whenever it was captured. Only running the worker's own query per row shows that. Pair
 * it with scripts/admin/repairAreaAlerts.ts, which fixes what this finds.
 *
 * Uses the builders the worker uses (buildAreaClause + bubbleAlertFilter), so these are
 * the worker's numbers rather than an approximation of them.
 *
 * Run:  npx tsx scripts/admin/alertScopeProbe.ts <email> [days]
 */
import 'dotenv/config';
import Typesense from 'typesense';
import { Client } from 'pg';
import { buildAreaClause } from '@/lib/bubbles/stats';
import { bubbleAlertFilter } from '@/lib/alerts/bubbleFilterClause';
import { buildLensClauses } from '@/lib/dashboard/queries';
import { normalizeConfig } from '@/lib/dashboard/config';

const EMAIL = process.argv[2] || 'blackj2991@gmail.com';
const DAYS = Number(process.argv[3] || 7);
const SALES_FLOOR = 'ListPrice:>=100000';

const ts = new Typesense.Client({
  nodes: [{ host: '9uyapwh6e5qmvl34p-1.a1.typesense.net', port: 443, protocol: 'https' }],
  apiKey: process.env.TYPESENSE_ADMIN_API_KEY!,
  connectionTimeoutSeconds: 20,
});

async function count(filter: string): Promise<number> {
  const r = await ts.collections('properties').documents().search({
    q: '*', query_by: 'City', filter_by: filter, per_page: 0,
  });
  return r.found ?? 0;
}

(async () => {
  const pg = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await pg.connect();
  const { rows: prof } = await pg.query('select id from profiles where lower(email)=lower($1)', [EMAIL]);
  if (!prof.length) { console.log('no profile'); await pg.end(); return; }
  const uid = prof[0].id;

  const { rows: prefs } = await pg.query('select config from dashboard_prefs where user_id=$1', [uid]);
  const liveLens = normalizeConfig(prefs[0]?.config ?? {}).marketActivity;
  const liveRegions: string[] = (prefs[0]?.config?.regions ?? []) as string[];
  console.log('dashboard regions :', liveRegions);
  console.log('live lens         :', JSON.stringify(liveLens));

  const { rows: bubbles } = await pg.query(
    `select id, name, area_type, polygon, source, alerts_enabled, alert_scope, filters
       from market_bubbles where user_id=$1 order by created_at`, [uid]);

  const since = Date.now() - DAYS * 24 * 60 * 60 * 1000;
  const liveLensClause = buildLensClauses(liveLens);

  console.log(`\nNew listings entered in the last ${DAYS} days:\n`);
  for (const b of bubbles) {
    const area = buildAreaClause(b as never);
    if (!area) { console.log(`${b.name}: NO AREA CLAUSE`); continue; }
    const scoped = b.alert_scope === 'filtered' ? bubbleAlertFilter(b.filters) : { clause: null, label: null };
    const stored = scoped.clause ?? SALES_FLOOR;

    const withStored = await count(`${stored} && ${area} && EntryTimestamp:>${since}`);
    const withLive = await count(`ListPrice:>=100000 && ${liveLensClause} && ${area} && EntryTimestamp:>${since}`);
    const areaOnly = await count(`${SALES_FLOOR} && ${area} && EntryTimestamp:>${since}`);

    const onDash = liveRegions.includes(b.source?.city ?? '') || b.area_type !== 'city';
    console.log(
      `${b.alerts_enabled ? 'ON ' : 'off'} | ${onDash ? 'on-dashboard ' : 'ORPHAN      '} | ${String(b.name).padEnd(34)} ` +
      `stored-scope=${String(withStored).padStart(4)}  live-lens=${String(withLive).padStart(4)}  area-only=${String(areaOnly).padStart(4)}` +
      (scoped.label ? `   [${scoped.label}]` : '')
    );
  }

  console.log('\nDashboard areas with NO alert row at all:');
  for (const r of liveRegions) {
    if (!bubbles.some((b) => b.area_type === 'city' && b.source?.city === r && b.alerts_enabled)) {
      const area = buildAreaClause({ area_type: 'city', polygon: [], source: { kind: 'city', city: r } } as never)!;
      const n = await count(`${SALES_FLOOR} && ${area} && EntryTimestamp:>${since}`);
      console.log(`  ${r} — ${n} new listings missed in ${DAYS}d`);
    }
  }

  await pg.end();
})();
