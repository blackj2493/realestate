/**
 * Daily ETL orchestrator — the Railway-cron entry point for the full pipeline.
 *
 * ⚠️  NOT SCHEDULED ANYWHERE. Railway was abandoned (2026-06); the production pipeline is
 * .github/workflows/daily-sync.yml. A step added ONLY here never runs in prod — that is
 * exactly how "Refresh region metrics" and "Capture price events" sat unscheduled until
 * the 2026-07-22 canary alert (region_metrics 45h stale, price_events empty forever).
 * If you add a step, add it to daily-sync.yml; mirror it here only as documentation.
 *
 * WHY THIS EXISTS: the pipeline historically lived in .github/workflows/daily-sync.yml,
 * but GitHub Actions' egress to Supabase started truncating REST responses
 * ("premature close") — Supabase logged 200s while the runner never received the body.
 * Supabase and the Railway-hosted app were unaffected, so the durable fix is to run the
 * sync from Railway (same healthy path as the app). This script reproduces the workflow
 * step-for-step as a single process suited to a Railway cron service.
 *
 * SEMANTICS (mirrors the workflow):
 *   • Core sync is CRITICAL — if it fails, abort the rest and exit non-zero (the
 *     workflow skipped later steps on a hard sync failure).
 *   • Every other step is best-effort (continue-on-error): log, keep going, flag at end.
 *   • Each step is bounded by a timeout so one hang can't wedge the whole cron run
 *     (Railway has no 6h job ceiling, so a runaway step would otherwise run forever).
 *   • On ANY failure: exit non-zero (Railway marks the run failed → native
 *     notifications fire) and, if configured, send a Resend alert email.
 *
 * Run: npx tsx scripts/worker/dailySync.ts   (npm run sync:daily)
 */
import 'dotenv/config';
import { spawn } from 'node:child_process';

// 25h delta window (daily cadence + margin) for the steps that take --since.
const since = new Date(Date.now() - 25 * 3_600_000).toISOString();

interface Step {
  name: string;
  args: string[];
  /** Abort the whole run if this step fails (core sync only). */
  critical?: boolean;
  /** Hard cap; the child is killed if it overruns. Mirrors the workflow timeouts. */
  maxMinutes: number;
}

const STEPS: Step[] = [
  { name: 'Core sync (IDX/VOW/delisted)', args: ['scripts/worker/ingester.ts', 'sync'], critical: true, maxMinutes: 120 },
  { name: 'Refresh condo fee stats', args: ['scripts/admin/refresh-condo-fee-stats.ts', '--apply'], maxMinutes: 20 },
  // Precompute base-scope market aggregates into market_summary so the leaderboard/scorecard
  // never run the slow region_*_aggregates RPCs on the request path (migration 048).
  { name: 'Refresh market summary', args: ['scripts/admin/refresh-market-summary.ts', '--apply'], maxMinutes: 30 },
  // Precompute the full base-scope /analytics payload into region_metrics so the default
  // Market Trends view reads one point lookup instead of the live 11-RPC batch (migration 081).
  { name: 'Refresh region metrics', args: ['scripts/admin/refresh-region-metrics.ts', '--apply'], maxMinutes: 30 },
  // Multi-cut price ledger — diff fresh list prices vs last-known, append price_events (migration 069).
  { name: 'Capture price events', args: ['scripts/admin/capture-price-events.ts', '--apply'], maxMinutes: 20 },
  { name: 'Refresh property sale history', args: ['scripts/admin/refresh-property-sale-history.ts', '--apply'], maxMinutes: 20 },
  { name: 'Refresh AVM sqft calibration', args: ['scripts/admin/refresh-sqft-calibration.ts', '--apply'], maxMinutes: 20 },
  { name: 'Refresh AVM trend + offset', args: ['scripts/admin/refresh-avm-trend-offset.ts', '--apply'], maxMinutes: 15 },
  { name: 'Refresh property estimates (delta)', args: ['scripts/admin/refresh-property-estimates.ts', '--apply', '--since', since], maxMinutes: 30 },
  { name: 'Enrich geo Things-to-Know flags', args: ['scripts/worker/enrichGeoFlags.ts', '--since', since], maxMinutes: 25 },
  { name: 'Send watchlist alerts', args: ['scripts/worker/alerts.ts'], maxMinutes: 15 },
  { name: 'Revalidate synced listings', args: ['scripts/worker/revalidateListings.ts'], maxMinutes: 20 },
];

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Run one step as a child `tsx` process; resolve its exit code (timeout/spawn error → 1). */
function runStep(step: Step): Promise<number> {
  return new Promise((resolve) => {
    console.log(`\n=== ▶ ${step.name} ===`);
    const child = spawn('npx', ['tsx', ...step.args], { stdio: 'inherit', env: process.env });

    const timer = setTimeout(() => {
      console.error(`   ⏱  ${step.name} exceeded ${step.maxMinutes}m — terminating.`);
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 10_000).unref();
    }, step.maxMinutes * 60_000);

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(code ?? 1);
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      console.error(`   ❌ Failed to spawn ${step.name}: ${errMsg(err)}`);
      resolve(1);
    });
  });
}

/** Best-effort failure email via Resend. No-ops cleanly when unconfigured. */
async function notifyFailure(summary: string): Promise<void> {
  const to = process.env.SYNC_ALERT_EMAIL;
  const key = process.env.RESEND_API_KEY;
  if (!to || !key) {
    console.log(
      '   ℹ️  SYNC_ALERT_EMAIL or RESEND_API_KEY unset — skipping email (Railway native alerts still fire on the non-zero exit).'
    );
    return;
  }
  try {
    const { Resend } = await import('resend');
    const resend = new Resend(key);
    const from = process.env.ALERTS_FROM_EMAIL || 'support@pureproperty.ca';
    await resend.emails.send({ from, to, subject: '🔴 PureProperty daily sync failed', text: summary });
    console.log(`   📧 Failure email sent to ${to}`);
  } catch (err) {
    console.error(`   ⚠️  Failed to send failure email: ${errMsg(err)}`);
  }
}

async function main(): Promise<void> {
  const started = new Date().toISOString();
  console.log(`\n████ Daily sync orchestrator — started ${started} ████`);

  const failures: string[] = [];
  let aborted = false;

  for (const step of STEPS) {
    const code = await runStep(step);
    if (code === 0) {
      console.log(`=== ✅ ${step.name} ===`);
    } else {
      failures.push(`${step.name} (exit ${code})`);
      console.error(`=== ❌ ${step.name} failed (exit ${code}) ===`);
      if (step.critical) {
        console.error('   🛑 Core sync is critical — aborting remaining steps.');
        aborted = true;
        break;
      }
    }
  }

  if (failures.length > 0) {
    const summary = [
      `Daily sync started ${started} finished with ${failures.length} failed step(s):`,
      ...failures.map((f) => `  - ${f}`),
      aborted ? '\nPipeline ABORTED after the critical core-sync failure.' : '',
    ].join('\n');
    console.error(`\n${summary}`);
    await notifyFailure(summary);
    process.exitCode = 1;
  } else {
    console.log('\n✅ All steps completed successfully.');
  }
}

main().catch((err) => {
  console.error('💥 Orchestrator fatal:', errMsg(err));
  process.exit(1);
});
