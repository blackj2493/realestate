/**
 * Data-freshness heartbeat — OPERATOR alert (TRREB §6.3(h): feed data displayed on the VOW
 * must be refreshed at least every 24h).
 *
 * The nightly sync already opens a GitHub issue when it RUNS and FAILS — but that misses the
 * silent cases that actually cause stale data: the schedule stops firing (a job that never
 * runs can't "fail"), or a run "succeeds" while leaving the cursor behind. This check is
 * driven by the DATA's age, not a job's exit code, so it catches all of them.
 *
 * Signal — sync_state (id='master'):
 *   - last_sync_timestamp — the feed cursor. It is FROZEN on failure (syncCursor.ts) and
 *     never advances when the job doesn't run, so `now - last_sync_timestamp` IS the data
 *     staleness. This is the primary signal.
 *   - status              — 'failed' when the last run errored.
 *   - updated_at          — wall-clock of the last write; old ⇒ no run happened at all.
 *
 * On staleness it (a) emails the operator via Resend and (b) exits non-zero so the Actions
 * run also goes red (a second, independent alert channel). READ-ONLY on sync_state — it
 * never writes the cursor.
 *
 * Invoke: npx tsx scripts/worker/freshnessCheck.ts
 * Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *      (optional) RESEND_API_KEY + SYNC_ALERT_EMAIL to receive the email,
 *      (optional) ALERTS_FROM_EMAIL (Resend-verified sender), NEXT_PUBLIC_SITE_URL,
 *      (optional) SYNC_STALE_HOURS (default 26 = 24h rule + slack for the ≤5h sync window).
 */

import 'dotenv/config';
import { Resend } from 'resend';
import { getServiceRoleClient } from '@/lib/supabase/client';

const FROM = process.env.ALERTS_FROM_EMAIL || 'PureProperty Alerts <support@pureproperty.ca>';
const TO = process.env.SYNC_ALERT_EMAIL || '';
const SITE = (process.env.NEXT_PUBLIC_SITE_URL || 'https://www.pureproperty.ca').replace(/\/$/, '');
// 24h rule + slack for the ≤5h sync window (starts 03:00 UTC). Override via SYNC_STALE_HOURS.
const STALE_HOURS = Number(process.env.SYNC_STALE_HOURS) || 26;

interface MasterState {
  last_sync_timestamp: string | null;
  status: string | null;
  updated_at: string | null;
}

function hoursSince(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return (Date.now() - t) / 3_600_000;
}

const fmtAge = (n: number | null) => (n == null ? 'unknown' : `${n.toFixed(1)}h`);

interface ReportInput {
  stale: boolean;
  reason: string;
  cursorAgeH: number | null;
  status: string | null;
  updatedAgeH: number | null;
}

async function report({ stale, reason, cursorAgeH, status, updatedAgeH }: ReportInput): Promise<void> {
  const summary = `cursor age=${fmtAge(cursorAgeH)} · status=${status ?? 'unknown'} · last write=${fmtAge(updatedAgeH)}`;

  if (!stale) {
    console.log(`✅ Data is fresh (${summary}).`);
    return;
  }

  console.error(`🚨 STALE DATA: ${reason}. ${summary}`);

  if (!process.env.RESEND_API_KEY || !TO) {
    console.error(
      '   (no email sent — set RESEND_API_KEY + SYNC_ALERT_EMAIL to receive one; the non-zero exit still flags this run red.)'
    );
    return;
  }

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: FROM,
      to: TO,
      subject: `⚠️ PureProperty data is stale — ${reason.split(';')[0]}`,
      html: `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:560px;">
        <h2 style="color:#b91c1c;font-size:18px;margin:0 0 8px;">Listing data may be past the 24-hour refresh rule</h2>
        <p style="color:#334155;font-size:14px;margin:0 0 12px;">${reason}.</p>
        <table style="font-size:13px;color:#475569;border-collapse:collapse;">
          <tr><td style="padding:2px 12px 2px 0;">Data cursor age</td><td><b>${fmtAge(cursorAgeH)}</b></td></tr>
          <tr><td style="padding:2px 12px 2px 0;">Last sync status</td><td><b>${status ?? 'unknown'}</b></td></tr>
          <tr><td style="padding:2px 12px 2px 0;">sync_state last written</td><td><b>${fmtAge(updatedAgeH)} ago</b></td></tr>
        </table>
        <p style="color:#64748b;font-size:13px;margin:14px 0 0;">
          Check the <b>Daily Real Estate Sync</b> GitHub Action, then <a href="${SITE}">${SITE}</a>. The cursor is
          preserved on failure, so re-running the sync catches up safely — no manual reset needed unless
          readSyncState itself failed.
        </p>
      </div>`,
      text: `PureProperty data may be stale: ${reason}. ${summary}. Check the daily-sync GitHub Action: ${SITE}`,
    });
    console.error(`   📧 Alert emailed to ${TO}.`);
  } catch (e) {
    console.error('   ❌ Failed to send freshness alert email:', e instanceof Error ? e.message : e);
  }
}

async function main(): Promise<void> {
  const client = getServiceRoleClient();
  const { data, error } = await client
    .from('sync_state')
    .select('last_sync_timestamp, status, updated_at')
    .eq('id', 'master')
    .single();

  if (error || !data) {
    // Can't even read the cursor — treat as a hard problem worth an alert.
    await report({
      stale: true,
      reason: `could not read sync_state.master (${error?.message || 'no row'})`,
      cursorAgeH: null,
      status: null,
      updatedAgeH: null,
    });
    process.exit(1);
  }

  const s = data as MasterState;
  const cursorAgeH = hoursSince(s.last_sync_timestamp);
  const updatedAgeH = hoursSince(s.updated_at);

  const reasons: string[] = [];
  if (cursorAgeH == null) reasons.push('last_sync_timestamp is missing/invalid');
  else if (cursorAgeH > STALE_HOURS) reasons.push(`data cursor is ${cursorAgeH.toFixed(1)}h old (> ${STALE_HOURS}h)`);
  if (s.status === 'failed') reasons.push('last sync status is "failed"');
  if (updatedAgeH != null && updatedAgeH > STALE_HOURS)
    reasons.push(`sync_state hasn't been written in ${updatedAgeH.toFixed(1)}h (the job may not be running)`);

  const stale = reasons.length > 0;
  await report({ stale, reason: stale ? reasons.join('; ') : 'fresh', cursorAgeH, status: s.status, updatedAgeH });
  process.exit(stale ? 1 : 0);
}

main().catch((e) => {
  console.error('freshnessCheck failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
