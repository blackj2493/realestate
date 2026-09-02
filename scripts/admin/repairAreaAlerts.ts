/**
 * One-off repair for accounts whose new-listing ALERT rows drifted from the areas their
 * dashboard shows — the damage `src/lib/dashboard/areaAlertSync.ts` now prevents.
 *
 * Four independent passes. Read the plan before you apply it.
 *
 *   --orphans   DELETE alerting `market_bubbles` city rows for an area the dashboard no
 *               longer lists. These are the rows emailing new listings for areas the user
 *               removed, with no UI anywhere to see or mute them. REDUCES email.
 *   --dupes     DELETE duplicate city rows for the same (user, area), keeping the oldest
 *               and its watermark. Two writers could race before the POST became
 *               idempotent. REDUCES email.
 *   --resnap    Re-sync a 'filtered' row's frozen `{ lens }` to the account's CURRENT
 *               dashboard lens. "My filters only" used to capture once and never follow.
 *               Usually WIDENS what matches.
 *   --silent    CREATE the missing alert row for a dashboard area that has none, at the
 *               tiered default scope. INCREASES email — off unless you ask for it, and
 *               worth reading the count first.
 *
 * With no pass flag, all THREE reducing passes run (orphans, dupes, resnap); --silent is
 * always explicit. --apply writes; without it nothing is written.
 *
 * A created row is left with notify_since NULL on purpose: the worker baselines it
 * silently on its next run and the first email arrives the night after, so nobody gets a
 * backlog dump of everything they missed.
 *
 * NEVER re-enables a muted row. `alerts_enabled = false` is the bell's decision.
 * NEVER deletes for an account whose `regions` is empty while it still holds city rows —
 * that shape is a stale/degraded blob, not someone clearing their workspace.
 * NEVER touches draw / commute / school areas. They do not live in config.regions.
 *
 * Run:
 *   npx tsx scripts/admin/repairAreaAlerts.ts                        # plan, every account
 *   npx tsx scripts/admin/repairAreaAlerts.ts --user=someone@x.com   # plan, one account
 *   npx tsx scripts/admin/repairAreaAlerts.ts --user=someone@x.com --apply
 *   npx tsx scripts/admin/repairAreaAlerts.ts --silent --apply       # also turn the missing ones on
 */
import 'dotenv/config';
import { getServiceRoleClient } from '@/lib/supabase/client';
import { defaultAlertScopeForRegion } from '@/lib/dashboard/area';
import { normalizeConfig, type MarketActivityLens } from '@/lib/dashboard/config';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const ONLY_USER = (args.find((a) => a.startsWith('--user=')) ?? '').split('=')[1] ?? null;
const WANT_SILENT = args.includes('--silent');
const picked = ['--orphans', '--dupes', '--resnap'].filter((f) => args.includes(f));
const PASS = {
  orphans: picked.length === 0 || picked.includes('--orphans'),
  dupes: picked.length === 0 || picked.includes('--dupes'),
  resnap: picked.length === 0 || picked.includes('--resnap'),
  silent: WANT_SILENT,
};

/** QA fixtures inflate every population number here; they are never real accounts. */
const QA_SUFFIX = '@pureproperty-qa.test';

interface BubbleRow {
  id: string;
  user_id: string;
  name: string;
  area_type: string;
  source: { kind?: string; city?: string } | null;
  alerts_enabled: boolean | null;
  alert_scope: string | null;
  filters: unknown;
  created_at: string;
}

/** Field-by-field: jsonb re-orders keys, so a stringify compare always reports "changed". */
function sameLens(a: MarketActivityLens, b: MarketActivityLens): boolean {
  return (
    a.transactionType === b.transactionType &&
    a.minBeds === b.minBeds &&
    a.bedsExact === b.bedsExact &&
    a.minBaths === b.minBaths &&
    a.bathsExact === b.bathsExact &&
    a.minGarage === b.minGarage &&
    a.garageExact === b.garageExact &&
    a.basement === b.basement &&
    a.minFrontage === b.minFrontage &&
    a.propertyTypes.length === b.propertyTypes.length &&
    a.propertyTypes.every((t, i) => t === b.propertyTypes[i])
  );
}

function storedLens(filters: unknown): MarketActivityLens | null {
  if (!filters || typeof filters !== 'object' || !('lens' in filters)) return null;
  const raw = (filters as { lens?: unknown }).lens;
  if (!raw || typeof raw !== 'object') return null;
  return normalizeConfig({ marketActivity: raw }).marketActivity;
}

async function main() {
  const sb = getServiceRoleClient();

  const { data: profiles, error: pErr } = await sb.from('profiles').select('id, email');
  if (pErr) throw new Error(`profiles read failed: ${pErr.message}`);
  const emailById = new Map<string, string>();
  for (const p of profiles ?? []) {
    const email = ((p as { email?: string }).email ?? '').trim();
    if (email.endsWith(QA_SUFFIX)) continue;
    if (ONLY_USER && email.toLowerCase() !== ONLY_USER.toLowerCase()) continue;
    emailById.set((p as { id: string }).id, email);
  }
  if (ONLY_USER && emailById.size === 0) {
    console.error(`No non-QA profile for ${ONLY_USER}`);
    process.exit(1);
  }

  const { data: prefs, error: dErr } = await sb.from('dashboard_prefs').select('user_id, config');
  if (dErr) throw new Error(`dashboard_prefs read failed: ${dErr.message}`);
  const configById = new Map<string, unknown>();
  for (const row of prefs ?? []) {
    configById.set((row as { user_id: string }).user_id, (row as { config: unknown }).config);
  }

  const { data: bubbles, error: bErr } = await sb
    .from('market_bubbles')
    .select('id, user_id, name, area_type, source, alerts_enabled, alert_scope, filters, created_at')
    .order('created_at', { ascending: true });
  if (bErr) throw new Error(`market_bubbles read failed: ${bErr.message}`);

  const byUser = new Map<string, BubbleRow[]>();
  for (const row of (bubbles ?? []) as unknown as BubbleRow[]) {
    if (!emailById.has(row.user_id)) continue;
    byUser.set(row.user_id, [...(byUser.get(row.user_id) ?? []), row]);
  }

  const deleteIds: string[] = [];
  const resnaps: { id: string; lens: MarketActivityLens }[] = [];
  const creates: Record<string, unknown>[] = [];
  let heldEmpty = 0;
  let accountsTouched = 0;

  // Every account with EITHER a config row or a bubble row — an account can have alert
  // rows and no config at all, which is exactly how orphans survive unseen.
  const userIds = new Set<string>([...configById.keys(), ...byUser.keys()]);

  for (const userId of userIds) {
    const email = emailById.get(userId);
    if (!email) continue;

    const cfg = normalizeConfig(configById.get(userId) ?? {});
    const regions = Array.from(
      new Set(
        (Array.isArray(cfg.regions) ? cfg.regions : [])
          .filter((r): r is string => typeof r === 'string')
          .map((r) => r.trim())
          .filter(Boolean)
      )
    );
    const rows = byUser.get(userId) ?? [];
    const cityRows = rows.filter((r) => r.area_type === 'city');
    const cityOf = (r: BubbleRow) => (r.source?.city ?? '').trim();

    const lines: string[] = [];

    // ── dupes: same (user, area) more than once. Keep the oldest — it owns the watermark.
    const seen = new Map<string, BubbleRow>();
    const dupes: BubbleRow[] = [];
    for (const r of cityRows) {
      const key = cityOf(r);
      if (!key) continue;
      if (seen.has(key)) dupes.push(r);
      else seen.set(key, r);
    }
    if (PASS.dupes && dupes.length) {
      deleteIds.push(...dupes.map((r) => r.id));
      for (const r of dupes) lines.push(`  dupe    ✂  ${cityOf(r)}  (${r.id})`);
    }

    const live = cityRows.filter((r) => !dupes.includes(r));

    // ── orphans: alerting rows for an area the dashboard no longer lists.
    const wanted = new Set(regions);
    const orphans = live.filter((r) => !wanted.has(cityOf(r)) && r.alerts_enabled !== false);
    if (orphans.length) {
      if (regions.length === 0) {
        heldEmpty += orphans.length;
        for (const r of orphans) lines.push(`  orphan  ⏸  ${cityOf(r)}  (held — config.regions is empty)`);
      } else if (PASS.orphans) {
        deleteIds.push(...orphans.map((r) => r.id));
        for (const r of orphans) lines.push(`  orphan  ✂  ${cityOf(r)}`);
      }
    }

    // ── resnap: a 'filtered' row whose captured lens no longer matches the dashboard.
    if (PASS.resnap) {
      for (const r of live) {
        if (!wanted.has(cityOf(r)) || r.alert_scope !== 'filtered') continue;
        const stored = storedLens(r.filters);
        if (!stored || sameLens(stored, cfg.marketActivity)) continue;
        resnaps.push({ id: r.id, lens: cfg.marketActivity });
        lines.push(`  resnap  ↻  ${cityOf(r)}`);
      }
    }

    // ── silent: a dashboard area with no alert row at all.
    const have = new Set(live.map(cityOf));
    const missing = regions.filter((r) => !have.has(r));
    if (missing.length) {
      for (const name of missing) {
        const scope = defaultAlertScopeForRegion(name);
        if (PASS.silent) {
          creates.push({
            user_id: userId,
            name,
            area_type: 'city',
            polygon: [],
            source: { kind: 'city', city: name },
            filters: scope === 'filtered' ? { lens: cfg.marketActivity } : null,
            alert_scope: scope,
          });
          lines.push(`  silent  +  ${name}  (${scope})`);
        } else {
          lines.push(`  silent  ·  ${name}  — no alert row (pass --silent to create)`);
        }
      }
    }

    // A muted row on a live area is reported, never changed: only the bell may un-mute.
    for (const r of live) {
      if (wanted.has(cityOf(r)) && r.alerts_enabled === false) {
        lines.push(`  muted   ·  ${cityOf(r)}  — on the dashboard but alerts OFF (tap the bell)`);
      }
    }

    if (lines.length) {
      accountsTouched++;
      console.log(`\n${email}`);
      console.log(`  regions: ${regions.length ? regions.join(', ') : '(none)'}`);
      for (const l of lines) console.log(l);
    }
  }

  console.log(
    `\n── plan ─────────────────────────────────────────────\n` +
      `accounts affected : ${accountsTouched}\n` +
      `rows to delete    : ${deleteIds.length}\n` +
      `rows to re-snap   : ${resnaps.length}\n` +
      `rows to create    : ${creates.length}${PASS.silent ? '' : '  (--silent not set)'}\n` +
      `held (empty cfg)  : ${heldEmpty}\n`
  );

  if (!APPLY) {
    console.log('DRY RUN — nothing written. Re-run with --apply.');
    return;
  }

  if (deleteIds.length) {
    // Chunked: a very long `in` list becomes a URL PostgREST will refuse.
    for (let i = 0; i < deleteIds.length; i += 100) {
      const chunk = deleteIds.slice(i, i + 100);
      const { error } = await sb.from('market_bubbles').delete().in('id', chunk);
      if (error) throw new Error(`delete failed: ${error.message}`);
    }
    console.log(`deleted ${deleteIds.length} rows`);
  }
  for (const r of resnaps) {
    const { error } = await sb
      .from('market_bubbles')
      .update({ filters: { lens: r.lens } })
      .eq('id', r.id);
    if (error) throw new Error(`resnap failed on ${r.id}: ${error.message}`);
  }
  if (resnaps.length) console.log(`re-snapped ${resnaps.length} rows`);

  if (creates.length) {
    const { error } = await sb.from('market_bubbles').insert(creates);
    if (error) throw new Error(`insert failed: ${error.message}`);
    console.log(`created ${creates.length} rows (they baseline silently; first email tomorrow night)`);
  }

  console.log('Done.');
}

main().catch((e) => {
  console.error('[repairAreaAlerts]', e instanceof Error ? e.message : e);
  process.exit(1);
});
