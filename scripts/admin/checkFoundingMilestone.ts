/**
 * Email the operator when founding seats cross a line.
 *
 * The whole point of a 200-seat offer is knowing when it's nearly gone: 180 is the
 * "decide what happens at 200" warning, and 200 itself is "the offer is closed and
 * the page has changed under you". Both are moments to act on, and neither is
 * visible unless someone happens to load the page.
 *
 * Sends AT MOST ONCE per threshold. The guard is the ops_milestones primary key
 * (migration 111): we INSERT ... ON CONFLICT DO NOTHING and only email when the
 * insert actually created the row, so the "have I sent this?" check and the "record
 * that I sent it" write are one atomic step. Two overlapping cron runs cannot
 * double-send, and a missed run just alerts late rather than never.
 *
 * No-ops cleanly when RESEND_API_KEY / SYNC_ALERT_EMAIL are unset (logs and exits 0),
 * matching notifyRun.ts — so it is safe to schedule before the secrets exist.
 *
 * Usage:
 *   npx tsx scripts/admin/checkFoundingMilestone.ts            # check + send if crossed
 *   npx tsx scripts/admin/checkFoundingMilestone.ts --dry-run  # report, never send or record
 *   FOUNDING_MILESTONES=150,180,200 npx tsx scripts/admin/checkFoundingMilestone.ts
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import dotenv from 'dotenv';

dotenv.config();

const TOTAL = 200;
const DRY = process.argv.includes('--dry-run');
const FROM = process.env.ALERTS_FROM_EMAIL || 'PureProperty Alerts <support@pureproperty.ca>';
const TO = process.env.SYNC_ALERT_EMAIL || '';
const SITE = (process.env.NEXT_PUBLIC_SITE_URL || 'https://www.pureproperty.ca').replace(/\/$/, '');

/** Ascending. 180 = "20 left, decide now"; 200 = "closed, the page has changed". */
const MILESTONES = (process.env.FOUNDING_MILESTONES || '180,200')
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n) && n > 0)
  .sort((a, b) => a - b);

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const { count: taken, error } = await supabase
    .from('founding_seats')
    .select('seat', { count: 'exact', head: true });
  if (error) {
    console.error('Could not read founding_seats:', error.message);
    process.exit(1);
  }
  const seats = taken ?? 0;

  // Pace, so the email answers "how long have I got?" and not just "it happened".
  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count: last24 } = await supabase
    .from('founding_seats')
    .select('seat', { count: 'exact', head: true })
    .gte('created_at', dayAgo);

  console.log(`founding seats : ${seats}/${TOTAL}  (+${last24 ?? 0} in 24h)`);
  console.log(`milestones     : ${MILESTONES.join(', ')}`);

  const crossed = MILESTONES.filter((m) => seats >= m);
  if (!crossed.length) {
    console.log(`nothing crossed — next is ${MILESTONES.find((m) => m > seats) ?? '(none)'}`);
    return;
  }

  for (const milestone of crossed) {
    const milestoneKey = `founding_seats:${milestone}`;

    if (DRY) {
      const { data: already } = await supabase
        .from('ops_milestones')
        .select('key, notified_at')
        .eq('key', milestoneKey)
        .maybeSingle();
      console.log(
        already
          ? `  ${milestoneKey}: already announced ${already.notified_at} — would NOT resend`
          : `  ${milestoneKey}: WOULD email ${TO || '(no recipient configured)'}`,
      );
      continue;
    }

    // Claim the milestone FIRST. If the row already existed the insert returns no
    // data, which is our proof someone (or an earlier run) already announced it.
    const { data: claimed } = await supabase
      .from('ops_milestones')
      .insert({ key: milestoneKey, value: seats })
      .select('key')
      .maybeSingle();

    if (!claimed) {
      console.log(`  ${milestoneKey}: already announced — skipping`);
      continue;
    }

    const sent = await sendMilestoneEmail(milestone, seats, last24 ?? 0);
    if (!sent) {
      // Un-claim, so a later run with working email still gets to announce it.
      // Better to risk a duplicate than to swallow the alert entirely.
      await supabase.from('ops_milestones').delete().eq('key', milestoneKey);
      console.log(`  ${milestoneKey}: email not sent — milestone released for a retry`);
    }
  }
}

async function sendMilestoneEmail(milestone: number, seats: number, last24: number): Promise<boolean> {
  const left = Math.max(0, TOTAL - seats);
  const full = seats >= TOTAL;
  const subject = full
    ? `All ${TOTAL} founding seats are taken`
    : `${seats}/${TOTAL} founding seats taken — ${left} left`;

  const body = full
    ? `The founding-seat offer is closed. The page has already stopped inviting new claims — anyone arriving now is told the seats are gone.\n\nDecide whether to open a second tranche or retire the offer.`
    : `${seats} of ${TOTAL} founding seats are taken. ${left} remain.\n\nAt the last 24 hours' pace (+${last24}), the rest go in roughly ${last24 > 0 ? `${Math.max(1, Math.ceil(left / last24))} day(s)` : 'an unknown time — nothing claimed today'}.`;

  console.log(`  → ${subject}`);

  if (!process.env.RESEND_API_KEY || !TO) {
    console.log('    (no email sent — set RESEND_API_KEY + SYNC_ALERT_EMAIL)');
    return false;
  }

  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:600px;">
    <p style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:34px;font-weight:700;color:${full ? '#b45309' : '#0e7490'};margin:0 0 4px;">${seats}<span style="color:#94a3b8;font-weight:400;">/${TOTAL}</span></p>
    <p style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#64748b;margin:0 0 16px;">founding seats taken</p>
    <p style="color:#0f172a;font-size:15px;line-height:1.6;margin:0 0 14px;white-space:pre-line;">${body}</p>
    <p style="color:#475569;font-size:13px;margin:0 0 16px;">Claimed in the last 24h: <b style="font-family:ui-monospace,Menlo,Consolas,monospace;">${last24}</b></p>
    <p style="margin:0 0 18px;"><a href="${SITE}/whats-my-home-hiding" style="display:inline-block;background:#0891b2;color:#fff;font-size:14px;font-weight:600;text-decoration:none;padding:11px 18px;border-radius:8px;">Open the page &rarr;</a></p>
    <p style="color:#94a3b8;font-size:12px;margin:0;">Automated milestone alert · sent once per threshold · <a href="${SITE}" style="color:#94a3b8;">${SITE}</a></p>
  </div>`;

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: FROM,
      to: TO,
      subject: `PureProperty · ${subject}`,
      html,
      text: `${subject}\n\n${body}\n\nClaimed in the last 24h: ${last24}\n${SITE}/whats-my-home-hiding`,
    });
    console.log(`    📧 emailed ${TO}`);
    return true;
  } catch (e) {
    console.error('    email failed:', e instanceof Error ? e.message : e);
    return false;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
