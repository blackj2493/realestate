/**
 * The morning operator report — how many signed up, how many came back, how many left,
 * and whether the mail actually went out.
 *
 * WHY DIRECT pg AND NOT PostgREST: the numbers this report is built on live in the `auth`
 * schema (`auth.users` for signups, `auth.sessions` for logins), which PostgREST does not
 * expose. Same connection style as the other admin readers, including the pooler-cert
 * workaround.
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
 * ── WHAT THE 2026-09-20 AUDIT CHANGED ──────────────────────────────────────────
 * Every figure the old report printed reproduced exactly; three of them measured
 * something narrower than their label claimed, so the queries — not the arithmetic —
 * moved:
 *
 *   1. RETURNING was `auth.sessions` alone. Supabase writes a session row at LOGIN and
 *      nothing on a token refresh, so a user who came back with a live session was
 *      invisible. It read 2 on 2026-09-19; the real figure was 23. It is now a union of
 *      five signed-in traces, with the old login-only number kept beside it.
 *   2. AREAS + LISTINGS SAVED added every market bubble. Signup requires an area, so the
 *      app creates one within seconds of each new account — 17 of the 18 bubbles on
 *      2026-09-19. The headline therefore rose whenever signups rose. Signup-created
 *      bubbles are now split out and reported separately.
 *   3. APPLICATIONS were framed as leads to work. /apply inserts its row 2-12 SECONDS
 *      BEFORE the account, so every name in that block had already finished. The block is
 *      now the two lists that are actually distinct: who signed up, and who started and
 *      never finished.
 *
 * Invoke: npx tsx scripts/worker/dailyMetrics.ts
 * Env:    DATABASE_URL, RESEND_API_KEY, ALERTS_FROM_EMAIL, SYNC_ALERT_EMAIL
 *         METRICS_DRY_RUN=1 prints the report instead of sending it.
 */
import 'dotenv/config';
import pg from 'pg';
import { renderDailyMetricsEmail } from '@/lib/alerts/dailyMetricsEmail';
import { sendTransactionalEmail } from '@/lib/alerts/sendEmail';
import type { DailyCounts, DailyMetricsInput, PersonRow } from '@/lib/ops/dailyMetrics';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // Supabase pooler cert, as the other readers

const DRY = process.env.METRICS_DRY_RUN === '1';
const FROM = process.env.ALERTS_FROM_EMAIL || 'PureProperty Alerts <alerts@pureproperty.ca>';
const TO = process.env.SYNC_ALERT_EMAIL || '';
const TZ = 'America/Toronto';
const QA = `lower(u.email) not like '%@pureproperty-qa.test'`;

/** A bubble created inside this window of the account is the signup flow's, not a save. */
const SIGNUP_GRACE = `interval '5 minutes'`;

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

/** "Name · email", or the email alone. Never an empty string. */
const who = (name: unknown, email: unknown): string =>
  [typeof name === 'string' ? name.trim() : '', typeof email === 'string' ? email.trim() : '']
    .filter(Boolean)
    .join(' · ') || 'unknown';

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

  /** The 8-day Toronto bound, reused by every windowed query including the hand-written
   *  ones. Written against whichever timestamp column is passed in. */
  const between = (col: string) => `
      ${col} >= (($1::date - 7)::text || ' 00:00')::timestamp at time zone '${TZ}'
      and ${col} < (($1::date + 1)::text || ' 00:00')::timestamp at time zone '${TZ}'`;

  /** The reported day alone, for the lists and the point-in-time reads. */
  const onDay = (col: string) => `
      ${col} >= ($1::text || ' 00:00')::timestamp at time zone '${TZ}'
      and ${col} < (($1::date + 1)::text || ' 00:00')::timestamp at time zone '${TZ}'`;

  /** Daily COUNT(*) over the 8-day window, bounded in Toronto time. `extra` carries the
   *  QA-account filter for anything joined to auth.users; tables keyed only by user_id
   *  (watchlist, bubbles, vow reads) need no filter because the QA accounts never used
   *  the product — they have no rows to exclude. */
  const win = (col: string, tbl: string, join = '', extra = '') => `
    select to_char(date(${col} at time zone '${TZ}'), 'YYYY-MM-DD') as day, count(*) as v
    from ${tbl} ${join}
    where ${between(col)}
      ${extra}
    group by 1`;

  /** Every signed-in trace a returning user can leave, each arm bounded so the union never
   *  scans a whole table. auth.sessions is LAST on purpose: it is the weakest of the five
   *  and the one that used to stand alone. */
  const returningArms = `
      select user_id, accessed_at as ts from vow_access_log where ${between('accessed_at')}
      union all select user_id, occurred_at from activation_events where user_id is not null and ${between('occurred_at')}
      union all select user_id, created_at from watchlist where ${between('created_at')}
      union all select user_id, created_at from market_bubbles where ${between('created_at')}
      union all select user_id, created_at from auth.sessions where ${between('created_at')}`;

  // Sequential, not Promise.all: one pg Client serialises queries anyway and warns that
  // overlapping them is deprecated in pg@9. Short reads cost nothing in a cron.
  const [
    listingViewers,
    signups,
    unsubs,
    watch,
    bubblesSaved,
    bubblesAtSignup,
    abandoned,
    vow,
    vowReaders,
    returning,
    returningLogins,
  ] = await seq([
    // Distinct browsers that opened a listing they had not opened before. The upsert on
    // (listing_key, viewer_id) means created_at is the FIRST sighting, never a revisit.
    () => series(`select to_char(date(created_at at time zone '${TZ}'), 'YYYY-MM-DD') as day, count(distinct viewer_id) as v
            from listing_views
            where ${between('created_at')}
            group by 1`),
    () => series(win('u.created_at', 'auth.users u', '', `and ${QA}`)),
    () => series(win('p.marketing_opt_out_at', 'profiles p', 'join auth.users u on u.id = p.id', `and ${QA}`)),
    () => series(win('created_at', 'watchlist')),
    // A deliberate area save: the account already existed when the bubble appeared. LEFT
    // JOIN so a bubble whose owner is gone still counts as a save rather than vanishing.
    () => series(`select to_char(date(b.created_at at time zone '${TZ}'), 'YYYY-MM-DD') as day, count(*) as v
            from market_bubbles b left join auth.users u on u.id = b.user_id
            where ${between('b.created_at')}
              and (u.created_at is null or b.created_at - u.created_at > ${SIGNUP_GRACE})
            group by 1`),
    // The area the signup flow hands a new account. Counted, shown, never added to saves.
    () => series(`select to_char(date(b.created_at at time zone '${TZ}'), 'YYYY-MM-DD') as day, count(*) as v
            from market_bubbles b join auth.users u on u.id = b.user_id
            where ${between('b.created_at')}
              and b.created_at - u.created_at <= ${SIGNUP_GRACE}
            group by 1`),
    // Started /apply, still has no account. Distinct by email because the form can be
    // submitted twice, and evaluated NOW — a late converter drops out of the count.
    () => series(`select to_char(date(a.created_at at time zone '${TZ}'), 'YYYY-MM-DD') as day,
              count(distinct lower(a.email)) as v
            from terminal_applications a
            where a.email is not null
              and not exists (select 1 from auth.users u where lower(u.email) = lower(a.email))
              and ${between('a.created_at')}
            group by 1`),
    () => series(win('accessed_at', 'vow_access_log')),
    () => series(`select to_char(date(accessed_at at time zone '${TZ}'), 'YYYY-MM-DD') as day,
              count(distinct user_id) as v
            from vow_access_log
            where ${between('accessed_at')}
            group by 1`),
    // Returning: a pre-existing account with ANY signed-in trace on the day.
    () => series(`select to_char(date(ev.ts at time zone '${TZ}'), 'YYYY-MM-DD') as day,
              count(distinct ev.user_id) as v
            from (${returningArms}) ev
            join auth.users u on u.id = ev.user_id
            where ${QA}
              and date(u.created_at at time zone '${TZ}') < date(ev.ts at time zone '${TZ}')
            group by 1`),
    // The old measure, kept as the honest sub-figure: they typed a password again.
    () => series(`select to_char(date(s.created_at at time zone '${TZ}'), 'YYYY-MM-DD') as day,
              count(distinct s.user_id) as v
            from auth.sessions s join auth.users u on u.id = s.user_id
            where ${QA}
              and date(u.created_at at time zone '${TZ}') < date(s.created_at at time zone '${TZ}')
              and ${between('s.created_at')}
            group by 1`),
  ]);

  const activation = (
    await c.query(
      `select kind, count(*)::int as count from activation_events
       where ${onDay('occurred_at')}
       group by 1 order by 2 desc`,
      [day]
    )
  ).rows.map((r) => ({ kind: String(r.kind), count: n(r.count) }));

  // Who signed up. A name comes from the OAuth profile, or failing that from the /apply
  // form; plenty of email signups give neither, so the email stands alone.
  const signupRows: PersonRow[] = (
    await c.query(
      `select u.created_at, u.email,
              coalesce(p.full_name,
                (select a.full_name from terminal_applications a
                  where lower(a.email) = lower(u.email) and a.full_name is not null
                  order by a.created_at limit 1)) as full_name,
              p.signup_intent
       from auth.users u left join profiles p on p.id = u.id
       where ${QA} and ${onDay('u.created_at')}
       order by u.created_at`,
      [day]
    )
  ).rows.map((r) => ({
    createdAt: new Date(r.created_at).toISOString(),
    who: who(r.full_name, r.email),
    detail: r.signup_intent ? String(r.signup_intent) : undefined,
  }));

  // Who started and never finished. DISTINCT ON keeps the first submission per email so a
  // double-submit is one person in the list.
  const abandonedRows: PersonRow[] = (
    await c.query(
      `select distinct on (lower(a.email)) a.created_at, a.full_name, a.email, a.regions
       from terminal_applications a
       where a.email is not null
         and not exists (select 1 from auth.users u where lower(u.email) = lower(a.email))
         and ${onDay('a.created_at')}
       order by lower(a.email), a.created_at`,
      [day]
    )
  )
    .rows.map((r) => ({
      createdAt: new Date(r.created_at).toISOString(),
      who: who(r.full_name, r.email),
      detail: Array.isArray(r.regions) && r.regions.length ? r.regions.join(', ') : undefined,
    }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const totals = (
    await c.query(`
      select
        (select count(*) from auth.users u where ${QA})::int as users,
        (select count(*) from profiles p join auth.users u on u.id = p.id
          where ${QA} and p.marketing_opt_out)::int as opted_out,
        (select count(*) from (
            select user_id from watchlist union select user_id from market_bubbles
         ) a join auth.users u on u.id = a.user_id where ${QA})::int as with_any_asset,
        (select count(distinct lower(a.email)) from terminal_applications a
          where a.email is not null
            and not exists (select 1 from auth.users u where lower(u.email) = lower(a.email))
         )::int as abandoned_all_time`)
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
        `select count(*) as v from email_send_failures where ${onDay('occurred_at')}`,
        [day]
      )
    ).rows[0]?.v
  );

  await c.end();

  const counts = (k: 'today' | 'prior7'): DailyCounts => ({
    listingViewers: listingViewers[k],
    signups: signups[k],
    returning: returning[k],
    returningLogins: returningLogins[k],
    unsubscribes: unsubs[k],
    assetsSaved: watch[k] + bubblesSaved[k],
    assetsAtSignup: bubblesAtSignup[k],
    abandonedSignups: abandoned[k],
    vowReads: vow[k],
    vowReaders: vowReaders[k],
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
    signups: signupRows,
    abandoned: abandonedRows,
    totals: {
      users: n(totals?.users),
      optedOut: n(totals?.opted_out),
      withAnyAsset: n(totals?.with_any_asset),
      abandonedAllTime: n(totals?.abandoned_all_time),
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
