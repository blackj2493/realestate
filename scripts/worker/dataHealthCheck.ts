/**
 * Data-health canary — catches SILENT derived-metric failures.
 *
 * Every derived-metric bug found in July 2026 shared one failure mode: it produced null or
 * empty rather than an error. Toronto's price cuts returned null (RPC starved under
 * contention). Toronto's rental yield returned zero rows (district-coded rents never rolled
 * up). Ottawa's sell-through returned "0 failed" → a fake 100%. Migration 082 was never
 * applied, so every market served stale numbers. Stale condo cohorts lingered with
 * pre-clamp trends. None of these threw; each rendered a plausible-looking page with a
 * missing panel or a "—", which reads as "no data for this cut" rather than "bug". And
 * because the metrics are PRECOMPUTED nightly, a silent failure gets frozen into a table
 * and served for days.
 *
 * This script is the IO shell: it fetches what the public pages actually render (the same
 * board functions) and hands it to the pure rules in src/lib/data/healthChecks.ts, which are
 * unit-tested by replaying each of those historical failures.
 *
 * Exits non-zero on any error-severity problem (red Actions run) AND emails the operator,
 * mirroring freshnessCheck.ts. That script watches the FEED cursor; this one watches the
 * DERIVED metrics — different failure domains, deliberately separate jobs.
 *
 * Invoke: npx tsx scripts/worker/dataHealthCheck.ts
 * Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *      (optional) RESEND_API_KEY + SYNC_ALERT_EMAIL to receive the email,
 *      (optional) ALERTS_FROM_EMAIL, NEXT_PUBLIC_SITE_URL,
 *      (optional) METRICS_STALE_HOURS (default 36), CONDO_STALE_DAYS (default 10),
 *      (optional) ESTIMATE_STALE_HOURS (default 48), ESTIMATE_MAX_AGE_HOURS (default 120).
 */
import 'dotenv/config';
import { Resend } from 'resend';
import * as fs from 'fs';
import * as path from 'path';
import { getServiceRoleClient } from '@/lib/supabase/client';
import { computeMarketBoardUncached, BOARD_MARKETS } from '@/lib/data/marketBoard';
import { computeCondoFeeBoardUncached } from '@/lib/data/condoFeeBoard';
import { TREND_MAX_ANNUAL_PCT } from '@/lib/condo/feeStability';
import {
  checkMarketRows,
  checkCondoRows,
  checkMigrationLedger,
  checkPriceLedger,
  checkEstimateFreshness,
  checkDrift,
  checkEmailFailures,
  snapshotFromRows,
  type Problem,
  type SnapshotEntry,
} from '@/lib/data/healthChecks';

const FROM = process.env.ALERTS_FROM_EMAIL || 'PureProperty Alerts <support@pureproperty.ca>';
const TO = process.env.SYNC_ALERT_EMAIL || '';
const SITE = (process.env.NEXT_PUBLIC_SITE_URL || 'https://www.pureproperty.ca').replace(/\/$/, '');
const METRICS_STALE_HOURS = Number(process.env.METRICS_STALE_HOURS) || 36;
const CONDO_STALE_DAYS = Number(process.env.CONDO_STALE_DAYS) || 10;
// Email failures are urgent (broken transactional email) — a short window keeps the alert
// current without re-firing on a failure that was already investigated and resolved.
const EMAIL_FAIL_LOOKBACK_HOURS = Number(process.env.EMAIL_FAIL_LOOKBACK_HOURS) || 48;
// 48h (vs 36 for region_metrics): state only moves when the capture RUNS, but a single
// missed night shouldn't page — two consecutive misses should.
const PRICE_STATE_STALE_HOURS = Number(process.env.PRICE_STATE_STALE_HOURS) || 48;
// Estimate heartbeat: the nightly delta re-estimates every re-synced listing, so
// max(computed_at) advances daily; 48h tolerates one missed night (the refresh step is
// continue-on-error), two consecutive misses fire.
const ESTIMATE_STALE_HOURS = Number(process.env.ESTIMATE_STALE_HOURS) || 48;
// Backlog threshold: every active row is re-based by the twice-weekly full recompute (≤ ~4-day
// cycle), so 120h (5d) sits safely above it — only rows that missed a recompute age past it.
const ESTIMATE_MAX_AGE_HOURS = Number(process.env.ESTIMATE_MAX_AGE_HOURS) || 120;
// Tolerance covers two benign populations: (1) the steady-state ACTIVE residual — ~1.35k
// genuinely-active listings the refresh can't re-estimate (no comps AND no GLA → skipped
// without a write; measured 2026-08); and (2) a rolling ORPHAN backlog. The nightly prune
// (prune-property-estimates.ts) only deletes an orphan once its estimate is >120h stale — the
// SAME threshold this canary counts at — so a whole recompute cohort's sold/terminal subset
// ages past 120h together and transiently counts as "stale" until the next daily prune clears
// it (measured 2026-08-03: +1,674 terminal orphans → 3,033 total, a false alarm; pruned back
// to 1,357). 4000 covers residual + a full cohort's orphan crossing with margin, while staying
// an order of magnitude below a real under-run (a failed recompute shard ≈ 20k). A cleaner fix
// (prune orphans promptly, or exclude them from the count) needs a whole-table listings status
// join that trips the statement timeout — deferred; this calibrates to the real baseline.
const ESTIMATE_STALE_TOLERANCE = Number(process.env.ESTIMATE_STALE_TOLERANCE) || 4000;

const problems: Problem[] = [];

async function checkMarketMetrics(): Promise<void> {
  const board = await computeMarketBoardUncached();
  problems.push(
    ...checkMarketRows({
      rows: board.rows,
      expectedMarkets: BOARD_MARKETS,
      dataAsOf: board.dataAsOf,
      staleHours: METRICS_STALE_HOURS,
    })
  );
  await checkMetricDrift(board.rows);
}

/**
 * Night-over-night drift — the wrong-but-plausible failure class the range checks cannot
 * see. Reads the most recent PRIOR day's snapshot, compares, then records tonight's.
 * Snapshot writing is best-effort: losing history must never fail the run.
 */
async function checkMetricDrift(rows: Awaited<ReturnType<typeof computeMarketBoardUncached>>['rows']): Promise<void> {
  const sb = getServiceRoleClient();
  const today = new Date().toISOString().slice(0, 10);
  const current = snapshotFromRows(rows);

  const { data: prevDay, error: dayErr } = await sb
    .from('metric_snapshots')
    .select('captured_on')
    .lt('captured_on', today)
    .order('captured_on', { ascending: false })
    .limit(1);
  if (dayErr) {
    problems.push({ severity: 'warn', check: 'drift', detail: `snapshot history unavailable (${dayErr.message}) — apply migration 090` });
  } else if (prevDay?.length) {
    const on = (prevDay[0] as { captured_on: string }).captured_on;
    const { data: prevRows } = await sb
      .from('metric_snapshots')
      .select('region, metric, value')
      .eq('captured_on', on);
    const prev: SnapshotEntry[] = (prevRows ?? []).map((r) => {
      const row = r as { region: string; metric: string; value: string | number | null };
      return { region: row.region, metric: row.metric, value: row.value == null ? null : Number(row.value) };
    });
    problems.push(...checkDrift(prev, current));
    console.log(`   drift compared against ${on} (${prev.length} prior values)`);
  } else {
    console.log('   drift: no prior snapshot yet — recording the first baseline');
  }

  // Record tonight (upsert so a same-day re-run overwrites rather than duplicating).
  const payload = current.map((e) => ({ captured_on: today, region: e.region, metric: e.metric, value: e.value }));
  const { error: writeErr } = await sb.from('metric_snapshots').upsert(payload, { onConflict: 'captured_on,region,metric' });
  if (writeErr) {
    problems.push({ severity: 'warn', check: 'drift', detail: `could not record snapshot: ${writeErr.message}` });
  }

  // Keep the table bounded — it is a monitoring signal, not an analytics store.
  const cutoff = new Date(Date.now() - 400 * 86_400_000).toISOString().slice(0, 10);
  await sb.from('metric_snapshots').delete().lt('captured_on', cutoff);
}

async function checkCondoFees(): Promise<void> {
  const board = await computeCondoFeeBoardUncached();

  // The board filters these out before render, so finding any means stale rows are
  // accumulating again (the eviction step regressed, or the estimator changed).
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from('condo_fee_stats')
    .select('cohort_type, cohort_key, pct_change_24mo')
    .or(`pct_change_24mo.gt.${TREND_MAX_ANNUAL_PCT},pct_change_24mo.lt.-${TREND_MAX_ANNUAL_PCT}`)
    .limit(20);
  if (error) {
    problems.push({ severity: 'warn', check: 'condo-clamp', detail: `could not check clamp violations: ${error.message}` });
  }
  const clampViolations = (data ?? []).map((r) => {
    const row = r as { cohort_type: string; cohort_key: string; pct_change_24mo: number };
    return { cohort_type: row.cohort_type, cohort_key: row.cohort_key, pct: row.pct_change_24mo };
  });

  problems.push(
    ...checkCondoRows({
      rows: board.rows,
      dataAsOf: board.dataAsOf,
      staleDays: CONDO_STALE_DAYS,
      clampViolations,
    })
  );
}

async function checkPriceLedgerFreshness(): Promise<void> {
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from('listing_price_state')
    .select('updated_at')
    .order('updated_at', { ascending: false })
    .limit(1);
  if (error) {
    problems.push({
      severity: 'warn',
      check: 'price-ledger',
      detail: `listing_price_state unavailable (${error.message}) — is migration 069 applied?`,
    });
    return;
  }
  problems.push(
    ...checkPriceLedger({
      stateNewest: data?.length ? String((data[0] as { updated_at: string }).updated_at) : null,
      staleHours: PRICE_STATE_STALE_HOURS,
    })
  );
}

/**
 * PureProperty Estimate (property_estimates) freshness — the precompute Compare and the
 * Command-Center batch read. Two cheap, single-table reads (no join to `listings`, whose
 * synced_at is unindexed and would risk the very statement-timeout this guards): the newest
 * computed_at (heartbeat) and a count of rows older than the recompute cycle (backlog). The
 * pure rules in checkEstimateFreshness decide.
 */
async function checkEstimateHealth(): Promise<void> {
  const sb = getServiceRoleClient();
  const staleCutoff = new Date(Date.now() - ESTIMATE_MAX_AGE_HOURS * 3_600_000).toISOString();

  const newest = await sb
    .from('property_estimates')
    .select('computed_at')
    .order('computed_at', { ascending: false })
    .limit(1);
  if (newest.error) {
    problems.push({
      severity: 'warn',
      check: 'estimate-freshness',
      detail: `property_estimates unavailable (${newest.error.message}) — is migration 023 applied?`,
    });
    return;
  }

  // head:true → count only, no rows read. Both counts are over one narrow row per active
  // listing (no full_payload TOAST), so they stay cheap for a once-daily canary.
  const stale = await sb
    .from('property_estimates')
    .select('listing_key', { count: 'exact', head: true })
    .lt('computed_at', staleCutoff);
  const total = await sb
    .from('property_estimates')
    .select('listing_key', { count: 'exact', head: true });
  if (stale.error || total.error) {
    problems.push({
      severity: 'warn',
      check: 'estimate-staleness',
      detail: `estimate backlog counts unavailable (${stale.error?.message ?? total.error?.message}) — heartbeat still checked`,
    });
  }

  problems.push(
    ...checkEstimateFreshness({
      estimateNewest: newest.data?.length ? String((newest.data[0] as { computed_at: string }).computed_at) : null,
      staleCount: stale.error ? 0 : stale.count ?? 0,
      totalCount: total.error ? 0 : total.count ?? 0,
      staleHours: ESTIMATE_STALE_HOURS,
      staleMaxHours: ESTIMATE_MAX_AGE_HOURS,
      staleTolerance: ESTIMATE_STALE_TOLERANCE,
    })
  );
}

async function checkMigrations(): Promise<void> {
  const dir = path.join(process.cwd(), 'supabase', 'migrations');
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  } catch {
    problems.push({ severity: 'warn', check: 'migrations', detail: 'could not read supabase/migrations (not running from the repo root?)' });
    return;
  }
  const sb = getServiceRoleClient();
  const { data, error } = await sb.from('schema_migrations').select('filename');
  if (error) {
    // Table missing ⇒ ledger not yet created/baselined. Warn rather than fail: the ledger
    // is itself migration 087 and needs a one-time --baseline run.
    problems.push({ severity: 'warn', check: 'migrations', detail: `schema_migrations unavailable (${error.message}) — apply 087 and run applyMigrationFiles --baseline` });
    return;
  }
  problems.push(...checkMigrationLedger(files, (data ?? []).map((r) => String((r as { filename: string }).filename))));
}

/**
 * Transactional email health — reads email_send_failures (098). Catches a dead Vercel
 * Resend key within a day; alerts from GitHub Actions, which works even when the web
 * runtime's Resend credential is broken (an email alert about broken email is circular).
 */
async function checkEmailHealth(): Promise<void> {
  const sb = getServiceRoleClient();
  const sinceIso = new Date(Date.now() - EMAIL_FAIL_LOOKBACK_HOURS * 3_600_000).toISOString();
  const { data, error } = await sb
    .from('email_send_failures')
    .select('kind, reason, occurred_at')
    .gte('occurred_at', sinceIso)
    .limit(500);
  if (error) {
    problems.push({ severity: 'warn', check: 'email-delivery', detail: `email_send_failures unavailable (${error.message}) — is migration 098 applied?` });
    return;
  }
  const rows = (data ?? []).map((r) => {
    const row = r as { kind: string; reason: string };
    return { kind: row.kind, reason: row.reason };
  });
  problems.push(...checkEmailFailures(rows));

  // Keep the table bounded — it is a monitoring signal, not an archive.
  const cutoff = new Date(Date.now() - 90 * 86_400_000).toISOString();
  await sb.from('email_send_failures').delete().lt('occurred_at', cutoff);
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function notify(errors: Problem[], warns: Problem[], infos: Problem[]): Promise<void> {
  const bad = errors.length > 0;
  if (!bad && warns.length === 0 && infos.length === 0) return; // all clear → stay quiet
  if (!process.env.RESEND_API_KEY || !TO) {
    console.log('(no email sent — set RESEND_API_KEY + SYNC_ALERT_EMAIL to receive one)');
    return;
  }
  const section = (title: string, items: Problem[], color: string) =>
    items.length
      ? `<h3 style="color:${color};font-size:14px;margin:14px 0 6px;">${title} (${items.length})</h3>
         <ul style="margin:0;padding-left:18px;color:#334155;font-size:13px;line-height:1.6;">
           ${items.map((p) => `<li><strong>${escapeHtml(p.check)}</strong> — ${escapeHtml(p.detail)}</li>`).join('')}
         </ul>`
      : '';
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:640px;">
    <h2 style="color:${bad ? '#b91c1c' : '#b45309'};font-size:18px;margin:0 0 4px;">
      ${bad ? '❌' : '⚠️'} Data health: ${errors.length} error(s), ${warns.length} warning(s)
    </h2>
    <p style="color:#475569;font-size:13px;margin:0 0 8px;">${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC</p>
    ${section('Errors', errors, '#b91c1c')}
    ${section('Warnings', warns, '#b45309')}
    ${section('Resolved gaps', infos, '#047857')}
    <p style="color:#94a3b8;font-size:12px;margin:16px 0 0;">Derived-metric canary · <a href="${SITE}/data">${SITE}/data</a></p>
  </div>`;
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: FROM,
      to: TO,
      subject: `${bad ? '❌' : '⚠️'} PureProperty · data health: ${errors.length} error(s), ${warns.length} warning(s)`,
      html,
      text: [...errors, ...warns, ...infos].map((p) => `[${p.severity}] ${p.check}: ${p.detail}`).join('\n'),
    });
    console.log(`📧 Notified ${TO}.`);
  } catch (e) {
    console.error('notify email failed (non-fatal):', e instanceof Error ? e.message : e);
  }
}

async function main(): Promise<void> {
  console.log('========================================');
  console.log('  Data health canary (derived metrics)');
  console.log('========================================\n');

  // Each check is independent: one throwing must not hide the others' findings.
  for (const [name, fn] of [
    ['market metrics', checkMarketMetrics],
    ['condo fees', checkCondoFees],
    ['price ledger', checkPriceLedgerFreshness],
    ['estimate freshness', checkEstimateHealth],
    ['email delivery', checkEmailHealth],
    ['migrations', checkMigrations],
  ] as const) {
    try {
      await fn();
      console.log(`   checked ${name}`);
    } catch (e) {
      problems.push({ severity: 'error', check: name, detail: `check threw: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  const errors = problems.filter((p) => p.severity === 'error');
  const warns = problems.filter((p) => p.severity === 'warn');
  const infos = problems.filter((p) => p.severity === 'info');

  console.log('\n──────── Result ────────');
  if (!problems.length) console.log('✅ All checks passed.');
  for (const p of [...errors, ...warns, ...infos]) {
    const icon = p.severity === 'error' ? '❌' : p.severity === 'warn' ? '⚠️ ' : 'ℹ️ ';
    console.log(`${icon} [${p.check}] ${p.detail}`);
  }
  console.log(`\n${errors.length} error(s), ${warns.length} warning(s), ${infos.length} info.`);

  await notify(errors, warns, infos);
  if (errors.length) process.exitCode = 1; // red run = second, independent alert channel
}

main().catch((e) => {
  console.error('CRASH:', e instanceof Error ? e.message : e);
  process.exit(1);
});
