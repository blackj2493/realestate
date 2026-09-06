/**
 * The morning operator report — how many signed up, how many looked without signing up,
 * how many left, and whether the mail actually went out.
 *
 * WHY DIRECT pg AND NOT PostgREST: the two numbers the report is built on live in the
 * `auth` schema (`auth.users` for signups, `auth.sessions` for returning users), which
 * PostgREST does not expose. Same connection style as the other admin readers, including
 * the pooler-cert workaround.
 *
 * READ-ONLY BY CONSTRUCTION: the session is opened with
 * `default_transaction_read_only = on`, so a future edit to a query here cannot write.
 *
 * TWO MEASUREMENT RULES (see src/lib/ops/dailyMetrics.ts for why):
 *   - every user count filters `@pureproperty-qa.test`;
 *   - a day is America/Toronto, so "yesterday" matches the day you actually had.
 *
 * FAILS LOUD: an unreadable metric must not become a confident zero. Any query error
 * aborts the run with a non-zero exit rather than mailing a report full of zeros that
 * looks like a bad day.
 *
 * Invoke: npx tsx scripts/worker/dailyMetrics.ts
 * Env:    DATABASE_URL, RESEND_API_KEY, ALERTS_FROM_EMAIL, SYNC_ALERT_EMAIL
 *         METRICS_DRY_RUN=1 prints the report instead of sending it.
 */
import 'dotenv/config';
import pg from 'pg';
import { renderDailyMetricsEmail } from '@/lib/alerts/dailyMetricsEmail';
import { sendTransactionalEmail } from '@/lib/alerts/sendEmail';
import type { DailyCounts, DailyMetricsInput, LeadRow } from '@/lib/ops/dailyMetrics';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // Supabase pooler cert, as the other readers

const DRY = process.env.METRICS_DRY_RUN === '1';
const FROM = process.env.ALERTS_FROM_EMAIL || 'PureProperty Alerts <alerts@pureproperty.ca>';
const TO = process.env.SYNC_ALERT_EMAIL || '';
const TZ = 'America/Toronto';
const QA = `lower(u.email) not like '%@pureproperty-qa.test'`;

/** Yesterday in Toronto, as YYYY-MM-DD. The report always covers a COMPLETE day. */
function reportDay(now = new Date()): string {
  const toronto = new Date(now.toLocaleString('en-US', { timeZone: TZ }));
  toronto.setDate(toronto.getDate() - 1);
  return `${toronto.getFullYear()}-${String(toronto.getMonth() + 1).padStart(2, '0')}-${String(toronto.getDate()).padStart(2, '0')}`;
}

const n = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

async function main(): Promise<void> {
  const day = reportDay();
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  await c.query('set default_transaction_read_only = on');
  await c.query(`set statement_timeout = '120s'`);

  /** One scalar per day for the reported day and each of the 7 before it. `sql` must
   *  select a Toronto `day` and a `v`, already restricted to the 8-day window.
   *
   *  `day` MUST come back as text (to_char), not a date. node-postgres maps a `date`
   *  column to a JS Date in the process's LOCAL zone, so comparing it to "YYYY-MM-DD"
   *  silently never matched: every row landed in the baseline and the reported day read
   *  zero while the average was inflated by 8/7. Caught in a dry run, not in review. */
  const series = async (sql: string): Promise<{ today: number; prior7: number }> => {
    const r = await c.query(sql, [day]);
    let today = 0;
    let sum = 0;
    for (const row of r.rows) {
      const d = String(row.day).slice(0, 10);
      if (d === day) today = n(row.v);
      else sum += n(row.v);
    }
    return { today, prior7: sum / 7 };
  };

  /** Await a list of series lazily, one at a time. */
  const seq = async (fns: Array<() => Promise<{ today: number; prior7: number }>>) => {
    const out: Array<{ today: number; prior7: number }> = [];
    for (const f of fns) out.push(await f());
    return out;
  };

  /** Daily COUNT(*) over the 8-day window, bounded in Toronto time. `extra` carries the
   *  QA-account filter for anything joined to auth.users; tables keyed only by user_id
   *  (watchlist, bubbles, vow reads) need no filter because the QA accounts never used
   *  the product — they have no rows to exclude. */
  const win = (col: string, tbl: string, join = '', extra = '') => `
    select to_char(date(${col} at time zone '${TZ}'), 'YYYY-MM-DD') as day, count(*) as v
    from ${tbl} ${join}
    where ${col} >= (($1::date - 7)::text || ' 00:00')::timestamp at time zone '${TZ}'
      and ${col} < (($1::date + 1)::text || ' 00:00')::timestamp at time zone '${TZ}'
      ${extra}
    group by 1`;

  // Sequential, not Promise.all: one pg Client serialises queries anyway and warns that
  // overlapping them is deprecated in pg@9. Eight short reads cost nothing in a cron.
  const [visitors, signups, unsubs, watch, bubbles, apps, vow, returning] = await seq([
    () => series(`select to_char(date(created_at at time zone '${TZ}'), 'YYYY-MM-DD') as day, count(distinct viewer_id) as v
            from listing_views
            where created_at >= (($1::date - 7)::text || ' 00:00')::timestamp at time zone '${TZ}'
              and created_at < (($1::date + 1)::text || ' 00:00')::timestamp at time zone '${TZ}'
            group by 1`),
    () => series(win('u.created_at', 'auth.users u', '', `and ${QA}`)),
    () => series(win('p.marketing_opt_out_at', 'profiles p', 'join auth.users u on u.id = p.id', `and ${QA}`)),
    () => series(win('created_at', 'watchlist')),
    () => series(win('created_at', 'market_bubbles')),
    () => series(win('created_at', 'terminal_applications')),
    () => series(win('accessed_at', 'vow_access_log')),
    // Returning = a session that day from someone who did NOT sign up that day.
    () => series(`select to_char(date(s.created_at at time zone '${TZ}'), 'YYYY-MM-DD') as day, count(distinct s.user_id) as v
            from auth.sessions s join auth.users u on u.id = s.user_id
            where ${QA}
              and date(u.created_at at time zone '${TZ}') <> date(s.created_at at time zone '${TZ}')
              and s.created_at >= (($1::date - 7)::text || ' 00:00')::timestamp at time zone '${TZ}'
              and s.created_at < (($1::date + 1)::text || ' 00:00')::timestamp at time zone '${TZ}'
            group by 1`),
  ]);

  const activation = (
    await c.query(
      `select kind, count(*)::int as count from activation_events
       where occurred_at >= ($1::text || ' 00:00')::timestamp at time zone '${TZ}'
         and occurred_at < (($1::date + 1)::text || ' 00:00')::timestamp at time zone '${TZ}'
       group by 1 order by 2 desc`,
      [day]
    )
  ).rows.map((r) => ({ kind: String(r.kind), count: n(r.count) }));

  const leads: LeadRow[] = (
    await c.query(
      `select created_at, applicant_type, full_name, email, regions from terminal_applications
       where created_at >= ($1::text || ' 00:00')::timestamp at time zone '${TZ}'
         and created_at < (($1::date + 1)::text || ' 00:00')::timestamp at time zone '${TZ}'
       order by created_at`,
      [day]
    )
  ).rows.map((r) => ({
    createdAt: new Date(r.created_at).toISOString(),
    kind: String(r.applicant_type ?? 'application'),
    who: [r.full_name, r.email].filter(Boolean).join(' · ') || 'unknown',
    detail: Array.isArray(r.regions) ? r.regions.join(', ') : (r.regions ?? undefined),
  }));

  const totals = (
    await c.query(`
      select
        (select count(*) from auth.users u where ${QA})::int as users,
        (select count(*) from profiles p join auth.users u on u.id = p.id
          where ${QA} and p.marketing_opt_out)::int as opted_out,
        (select count(*) from (
            select user_id from watchlist union select user_id from market_bubbles
         ) a join auth.users u on u.id = a.user_id where ${QA})::int as with_any_asset`)
  ).rows[0];

  // Email counters written by alerts.ts into the reserved _ops region.
  const ops = (
    await c.query(
      `select metric, value from metric_snapshots where region = '_ops' and captured_on = $1::date`,
      [day]
    )
  ).rows;
  const opsVal = (metric: string) => n(ops.find((r) => r.metric === metric)?.value);

  const sendFailures = n(
    (
      await c.query(
        `select count(*) as v from email_send_failures
         where occurred_at >= ($1::text || ' 00:00')::timestamp at time zone '${TZ}'
           and occurred_at < (($1::date + 1)::text || ' 00:00')::timestamp at time zone '${TZ}'`,
        [day]
      )
    ).rows[0]?.v
  );

  await c.end();

  const counts = (k: 'today' | 'prior7'): DailyCounts => ({
    visitors: visitors[k],
    signups: signups[k],
    returning: returning[k],
    unsubscribes: unsubs[k],
    assetsCreated: watch[k] + bubbles[k],
    applications: apps[k],
    vowReads: vow[k],
  });

  const model: DailyMetricsInput = {
    day,
    today: counts('today'),
    prior7: counts('prior7'),
    activation,
    email: {
      digestSent: opsVal('email.digest_sent'),
      digestFailed: opsVal('email.digest_failed'),
      digestSuppressed: opsVal('email.digest_suppressed'),
      sendFailures,
    },
    leads,
    totals: {
      users: n(totals?.users),
      optedOut: n(totals?.opted_out),
      withAnyAsset: n(totals?.with_any_asset),
    },
  };

  const { subject, html, text } = renderDailyMetricsEmail(model);

  if (DRY || !TO || !process.env.RESEND_API_KEY) {
    console.log(`[daily-metrics] ${DRY ? 'DRY RUN' : 'no recipient/key — printing instead'}`);
    console.log(`subject: ${subject}\n`);
    console.log(text);
    return;
  }

  const res = await sendTransactionalEmail({ kind: 'daily-metrics', from: FROM, to: TO, subject, html, text });
  if (!res.sent) {
    // Loud + non-zero: a report that silently fails to arrive is the same class of bug
    // this report exists to surface.
    console.error(`[daily-metrics] NOT SENT: ${res.error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`[daily-metrics] sent "${subject}" to ${TO}`);
}

main().catch((e) => {
  console.error('[daily-metrics] failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
