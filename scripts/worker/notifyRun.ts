/**
 * Generic run-notifier for scheduled maintenance jobs (schools refresh, geo reload, AVM
 * retrain, …). Emails the operator that a job RAN — on SUCCESS ("it ran, here's what it
 * did") and on FAILURE ("it broke") — so a silently-rotting cron becomes visible instead of
 * failing green. This is the single notification surface every refresh workflow calls as its
 * final `if: always()` step.
 *
 * Mirrors the freshnessCheck.ts / alerts.ts conventions:
 *   - No-ops cleanly (exit 0, just logs) when RESEND_API_KEY / SYNC_ALERT_EMAIL are unset,
 *     so it's safe in any environment.
 *   - NEVER throws into the workflow: a notification failure must not turn a green run red
 *     (and on a failed run the red status already stands on its own).
 *
 * Env:
 *   JOB_NAME      human label, e.g. "Schools Refresh"                     (default: "Scheduled job")
 *   JOB_STATUS    GitHub `job.status`: success | failure | cancelled      (default: "success")
 *   RUN_URL       link to the Actions run (built in the workflow)         (optional)
 *   SUMMARY_FILE  path to a captured stdout log; its last lines are quoted (optional)
 *   RESEND_API_KEY, ALERTS_FROM_EMAIL, SYNC_ALERT_EMAIL, NEXT_PUBLIC_SITE_URL
 *
 * Usage (workflow final step):
 *   - name: Notify
 *     if: always()
 *     env: { JOB_STATUS: ${{ job.status }}, JOB_NAME: "Schools Refresh", ... }
 *     run: npx tsx scripts/worker/notifyRun.ts
 */
import 'dotenv/config';
import { Resend } from 'resend';
import * as fs from 'fs';

const NAME = process.env.JOB_NAME || 'Scheduled job';
const STATUS = (process.env.JOB_STATUS || 'success').toLowerCase();
const OK = STATUS === 'success';
const FROM = process.env.ALERTS_FROM_EMAIL || 'PureProperty Alerts <support@pureproperty.ca>';
const TO = process.env.SYNC_ALERT_EMAIL || '';
const RUN_URL = process.env.RUN_URL || '';
const SITE = (process.env.NEXT_PUBLIC_SITE_URL || 'https://www.pureproperty.ca').replace(/\/$/, '');

/** Last `n` non-empty lines of a captured log — the human-readable "what happened". */
function tail(file: string | undefined, n: number): string {
  if (!file) return '';
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).slice(-n).join('\n');
  } catch {
    return '';
  }
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function main(): Promise<void> {
  const summary = tail(process.env.SUMMARY_FILE, 30);
  const emoji = OK ? '✅' : '❌';
  const verb = OK ? 'completed OK' : `FAILED (${STATUS})`;
  const headline = `${emoji} ${NAME} ${verb}`;

  // Always log to the run itself (visible in the Actions console regardless of email).
  console.log(headline);
  if (summary) console.log(`\n${summary}`);

  if (!process.env.RESEND_API_KEY || !TO) {
    console.log('(no email sent — set RESEND_API_KEY + SYNC_ALERT_EMAIL to receive one)');
    return;
  }

  const color = OK ? '#047857' : '#b91c1c';
  const when = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:600px;">
    <h2 style="color:${color};font-size:18px;margin:0 0 6px;">${emoji} ${escapeHtml(NAME)} — ${OK ? 'ran successfully' : 'FAILED'}</h2>
    <p style="color:#475569;font-size:13px;margin:0 0 12px;">${when}${RUN_URL ? ` · <a href="${RUN_URL}">view run</a>` : ''}</p>
    ${summary ? `<pre style="background:#0f172a;color:#e2e8f0;font-size:12px;line-height:1.5;padding:12px;border-radius:6px;overflow:auto;white-space:pre-wrap;">${escapeHtml(summary)}</pre>` : ''}
    <p style="color:#94a3b8;font-size:12px;margin:14px 0 0;">Automated data-freshness job · <a href="${SITE}">${SITE}</a></p>
  </div>`;

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: FROM,
      to: TO,
      subject: `${emoji} PureProperty · ${NAME} ${OK ? 'ran OK' : 'FAILED'}`,
      html,
      text: `${headline}\n${when}\n${RUN_URL}\n\n${summary}`,
    });
    console.log(`📧 Notified ${TO}.`);
  } catch (e) {
    // Notification is best-effort — never fail the job because email didn't send.
    console.error('notify email failed (non-fatal):', e instanceof Error ? e.message : e);
  }
}

main().catch((e) => {
  // Belt-and-suspenders: a notifier crash must never turn the run red.
  console.error('notifyRun error (non-fatal):', e instanceof Error ? e.message : e);
});
