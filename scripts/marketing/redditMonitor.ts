/**
 * Reddit-opportunity monitor — finds fresh posts/comments in Ontario housing
 * subreddits where a PureProperty reply would be welcome, and emails the
 * operator a digest with ready-to-edit draft replies (personal + company
 * voice). NOTHING is ever posted automatically — a human reads the thread,
 * edits the draft, and posts it (see docs/strategy/reddit-engagement-playbook.md).
 *
 * Transports (in preference order):
 *   1. Reddit OAuth "application-only" JSON — needs REDDIT_CLIENT_ID +
 *      REDDIT_CLIENT_SECRET from a free "script" app (reddit.com/prefs/apps).
 *      Reliable from CI; ~20 requests/run against a 100/min allowance.
 *   2. Public Atom feeds (.rss) — keyless fallback. Reddit rate-limits these
 *      hard (429 after ~1 req) and often blocks datacenter IPs, so this mode
 *      paces one request per 12s and is really for local testing.
 *
 * Dedupe/state: reddit_opportunities (migration 093). Insert-if-new on the
 * Reddit fullname; only never-seen items are emailed, so every digest is pure
 * signal. Failure emails come from the workflow's notifyRun step; a digest
 * only goes out when there are new matches.
 *
 * Usage:
 *   npx tsx scripts/marketing/redditMonitor.ts                  # dry-run: fetch+score, print, no DB/email
 *   npx tsx scripts/marketing/redditMonitor.ts --drafts         # dry-run + generate real drafts to the console
 *   npx tsx scripts/marketing/redditMonitor.ts --apply          # record in DB + email new matches
 *   npx tsx scripts/marketing/redditMonitor.ts --preview d.html # also write the digest HTML to a file
 *   npx tsx scripts/marketing/redditMonitor.ts --subs TorontoRealEstate --rss   # local smoke test
 */

// TLS env before importing the supabase client (mirrors the other refresh jobs).
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import dotenv from 'dotenv';
import * as fs from 'fs';
import { sendTelegramDigest, telegramConfigured } from './redditTelegram';
import { draftReply, draftTransport } from './redditDraftLLM';
import {
  CATEGORIES,
  LOOKBACK_HOURS,
  MAX_PER_DIGEST,
  SEARCHES,
  SUBREDDITS,
  TEMPLATES,
  type SubredditConfig,
} from './redditMonitorConfig';
import {
  ageHours,
  fillTemplate,
  isExcludedAuthor,
  isExcludedTitle,
  isProductFree,
  parseAtomFeed,
  scoreItem,
  type RedditItem,
  type ScoredItem,
} from './redditMonitorCore';

dotenv.config({ path: ['.env.local', '.env'] });

const APPLY = process.argv.includes('--apply');
const FORCE_RSS = process.argv.includes('--rss');
/** Dry-run only: generate real drafts and print them, without DB or Telegram. */
const DRAFTS = process.argv.includes('--drafts');
const argAfter = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const PREVIEW_PATH = argAfter('--preview');
const LOOKBACK = Number(argAfter('--lookback') ?? LOOKBACK_HOURS);
const MAX_DIGEST = Number(argAfter('--max') ?? MAX_PER_DIGEST);
const ONLY_SUBS = argAfter('--subs')?.split(',').map((s) => s.trim().toLowerCase());

const UA =
  process.env.REDDIT_USER_AGENT ||
  'web:ca.pureproperty.reddit-monitor:v1.0 (market-question monitor; contact support@pureproperty.ca)';
// Feeds are fetched with a browser-ish UA — Reddit 403s obvious bot UAs on the public endpoints.
const RSS_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const SITE = (process.env.NEXT_PUBLIC_SITE_URL || 'https://www.pureproperty.ca').replace(/\/$/, '');
const FROM = process.env.ALERTS_FROM_EMAIL || 'PureProperty Alerts <support@pureproperty.ca>';
const TO = process.env.MARKETING_ALERT_EMAIL || process.env.SYNC_ALERT_EMAIL || '';

function die(msg: string): never {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Feed plan
// ---------------------------------------------------------------------------

interface Feed {
  label: string;
  /** OAuth path (oauth.reddit.com) */
  path: string;
  /** RSS fallback URL (www.reddit.com) */
  rss: string;
  /** Sub config used for the geo gate; searches behave as geo-implied. */
  sub: Pick<SubredditConfig, 'geoImplied'>;
}

function buildFeeds(): Feed[] {
  const feeds: Feed[] = [];
  for (const sub of SUBREDDITS) {
    if (ONLY_SUBS && !ONLY_SUBS.includes(sub.name.toLowerCase())) continue;
    if (sub.posts) {
      feeds.push({
        label: `r/${sub.name} posts`,
        path: `/r/${sub.name}/new?limit=100&raw_json=1`,
        rss: `https://www.reddit.com/r/${sub.name}/new/.rss?limit=100`,
        sub,
      });
    }
    if (sub.comments) {
      feeds.push({
        label: `r/${sub.name} comments`,
        path: `/r/${sub.name}/comments?limit=100&raw_json=1`,
        rss: `https://www.reddit.com/r/${sub.name}/comments/.rss?limit=100`,
        sub,
      });
    }
  }
  if (!ONLY_SUBS) {
    for (const s of SEARCHES) {
      const q = encodeURIComponent(s.query);
      feeds.push({
        label: `search ${s.label}`,
        path: `/search?q=${q}&sort=new&t=week&limit=50&type=link&raw_json=1`,
        rss: `https://www.reddit.com/search.rss?q=${q}&sort=new&t=week&limit=50`,
        // Search queries are already brand-targeted; don't demand an Ontario place name.
        sub: { geoImplied: true },
      });
    }
  }
  return feeds;
}

// ---------------------------------------------------------------------------
// Transports
// ---------------------------------------------------------------------------

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 15_000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function getOauthToken(): Promise<string | null> {
  const id = (process.env.REDDIT_CLIENT_ID || '').trim();
  const secret = (process.env.REDDIT_CLIENT_SECRET || '').trim();
  if (!id || !secret) return null;
  const res = await fetchWithTimeout('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': UA,
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) die(`Reddit OAuth token request failed: HTTP ${res.status} — check REDDIT_CLIENT_ID/SECRET`);
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) die('Reddit OAuth token response had no access_token');
  return json.access_token;
}

/** Normalize an OAuth listing (posts, comments or search results) to RedditItems. */
function normalizeListing(json: unknown): RedditItem[] {
  const children = (json as { data?: { children?: { data: Record<string, unknown> }[] } })?.data?.children ?? [];
  const items: RedditItem[] = [];
  for (const c of children) {
    const d = c?.data;
    if (!d || typeof d.name !== 'string') continue;
    const kind = d.name.startsWith('t1_') ? 'comment' : d.name.startsWith('t3_') ? 'post' : null;
    if (!kind) continue;
    items.push({
      id: d.name,
      kind,
      subreddit: String(d.subreddit ?? ''),
      author: String(d.author ?? ''),
      title: String((kind === 'comment' ? d.link_title : d.title) ?? ''),
      body: String((kind === 'comment' ? d.body : d.selftext) ?? ''),
      permalink: `https://www.reddit.com${String(d.permalink ?? '')}`,
      createdUtc: new Date(Number(d.created_utc ?? 0) * 1000),
    });
  }
  return items;
}

async function fetchFeedOauth(feed: Feed, token: string): Promise<RedditItem[]> {
  const res = await fetchWithTimeout(`https://oauth.reddit.com${feed.path}`, {
    headers: { Authorization: `bearer ${token}`, 'User-Agent': UA },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return normalizeListing(await res.json());
}

async function fetchFeedRss(feed: Feed): Promise<RedditItem[]> {
  const doGet = () =>
    fetchWithTimeout(feed.rss, {
      headers: {
        'User-Agent': RSS_UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-CA,en;q=0.9',
      },
    });
  let res = await doGet();
  if (res.status === 429) {
    const wait = Math.max(Number(res.headers.get('retry-after') ?? 0) * 1000, 30_000);
    console.log(`  429 on ${feed.label} — waiting ${Math.round(wait / 1000)}s and retrying once`);
    await sleep(wait);
    res = await doGet();
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const subName = feed.label.startsWith('r/') ? feed.label.split(' ')[0].slice(2) : '';
  return parseAtomFeed(await res.text(), subName);
}

// ---------------------------------------------------------------------------
// Digest email
// ---------------------------------------------------------------------------

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function policyFor(subreddit: string): {
  policy: string;
  note: string;
  compliance?: string;
  warmup: boolean;
} {
  const cfg = SUBREDDITS.find((s) => s.name.toLowerCase() === subreddit.toLowerCase());
  // isProductFree is the single source of this rule — do not re-derive it here. It
  // treats an unlisted sub as strict, which is why the note below and the draft the
  // operator sees now agree with each other.
  const warmup = isProductFree(cfg);
  if (cfg) return { policy: cfg.policy, note: cfg.note, compliance: cfg.compliance, warmup };
  return {
    policy: 'no-links',
    note: 'Unlisted sub — nobody has checked its self-promo rules, so the draft is product-free. Read the rules before posting, and add it to SUBREDDITS if it is worth watching.',
    warmup,
  };
}

function draftBox(label: string, text: string): string {
  return `<div style="margin:8px 0 0;">
    <div style="font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:.04em;margin-bottom:3px;">${label}</div>
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:10px 12px;font-size:13px;line-height:1.55;color:#0f172a;white-space:pre-wrap;">${esc(text)}</div>
  </div>`;
}

function renderDigestHtml(items: ScoredItem[], overflow: number, now: Date): string {
  const cards = items
    .map((it) => {
      const p = policyFor(it.subreddit);
      const policyColor = p.policy === 'no-links' ? '#b91c1c' : p.policy === 'open' ? '#047857' : '#b45309';
      const excerpt = it.body.length > 280 ? `${it.body.slice(0, 280)}…` : it.body;
      return `<div style="border:1px solid #e2e8f0;border-radius:8px;padding:14px 16px;margin:0 0 14px;">
        <div style="font-size:12px;color:#64748b;margin-bottom:4px;">
          <span style="background:#eef2ff;color:#4338ca;border-radius:4px;padding:1px 7px;font-weight:600;">${esc(it.categoryLabel)}</span>
          &nbsp;r/${esc(it.subreddit)} · ${it.kind} · ${ageHours(it, now)}h ago · score ${it.score}${it.city ? ` · ${esc(it.city)}` : ''}
        </div>
        <a href="${esc(it.permalink)}" style="font-size:14px;font-weight:600;color:#1d4ed8;text-decoration:none;">${esc(it.title || '(comment)')}</a>
        ${excerpt ? `<p style="font-size:13px;color:#334155;line-height:1.5;margin:6px 0 0;">${esc(excerpt)}</p>` : ''}
        <p style="font-size:12px;color:${policyColor};margin:8px 0 0;"><strong>${p.policy.toUpperCase()}</strong> — ${esc(p.note)}</p>
        ${draftBox('Draft · personal voice', it.draftPersonal)}
        ${draftBox('Draft · company voice', it.draftCompany)}
      </div>`;
    })
    .join('\n');

  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:680px;">
    <h2 style="font-size:18px;margin:0 0 4px;">🎯 ${items.length} Reddit ${items.length === 1 ? 'opportunity' : 'opportunities'}</h2>
    <p style="color:#475569;font-size:13px;margin:0 0 14px;">Read the thread before replying — drafts are starting points, not scripts. Edit until it sounds like you.</p>
    ${cards}
    ${overflow > 0 ? `<p style="color:#94a3b8;font-size:12px;">+${overflow} more matched below the digest cap (recorded in reddit_opportunities with status 'overflow').</p>` : ''}
    <p style="color:#94a3b8;font-size:12px;margin:14px 0 0;">Reddit-opportunity monitor · playbook: docs/strategy/reddit-engagement-playbook.md · <a href="${SITE}">${SITE}</a></p>
  </div>`;
}

function renderDigestText(items: ScoredItem[], overflow: number, now: Date): string {
  const lines = items.map((it) => {
    const p = policyFor(it.subreddit);
    return [
      `[${it.categoryLabel}] r/${it.subreddit} · ${it.kind} · ${ageHours(it, now)}h ago · score ${it.score}`,
      it.title,
      it.permalink,
      `policy ${p.policy.toUpperCase()}: ${p.note}`,
      `--- personal ---\n${it.draftPersonal}`,
      `--- company ---\n${it.draftCompany}`,
    ].join('\n');
  });
  return lines.join('\n\n====================\n\n') + (overflow > 0 ? `\n\n(+${overflow} more over the digest cap)` : '');
}

/**
 * Rewrite each item's draft from its own thread text, in place.
 *
 * Shared by the live path and `--drafts`, so what you preview is exactly what
 * would be sent. Mutates the items rather than returning copies because the
 * delivery layer already holds these references.
 */
async function applyDrafts(items: ScoredItem[]): Promise<void> {
  const transport = draftTransport();
  if (transport === 'none') {
    console.log(
      '  no draft transport (no ANTHROPIC_API_KEY and no claude CLI found) — shipping template drafts (generic; see redditDraftLLM.ts)',
    );
    return;
  }

  // Named in the log because the two paths bill differently — 'cli' runs on the
  // Claude subscription, 'api' on API credits — and a silent switch between them
  // is the kind of thing you only notice on an invoice.
  console.log(`  drafting ${items.length} via ${transport === 'cli' ? 'Claude CLI (subscription)' : 'Anthropic API (credits)'}`);

  let rewritten = 0;
  let skipped = 0;
  for (const item of items) {
    const cfg = SUBREDDITS.find((s) => s.name.toLowerCase() === item.subreddit.toLowerCase());
    const r = await draftReply(item, cfg, isProductFree(cfg), item.draftPersonal);
    item.draftPersonal = r.draft;
    item.draftReason = r.reason;
    item.draftSkip = r.skip;
    item.draftFailed = r.failed;
    if (r.failed) console.log(`  (draft) ${item.id} fell back: ${r.reason}`);
    else if (r.skip) skipped++;
    else rewritten++;
  }
  console.log(`  drafts: ${rewritten} written · ${skipped} judged not worth replying to`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const now = new Date();
  const feeds = buildFeeds();
  console.log(
    `Reddit monitor · ${feeds.length} feeds · lookback ${LOOKBACK}h · ${APPLY ? 'APPLY' : 'dry-run'}${FORCE_RSS ? ' · forced RSS' : ''}`
  );

  const token = FORCE_RSS ? null : await getOauthToken();
  if (!token) {
    console.log(token === null && !FORCE_RSS
      ? '  no REDDIT_CLIENT_ID/SECRET — falling back to slow public RSS (fine locally, unreliable in CI)'
      : '  transport: public RSS (forced)');
  } else {
    console.log('  transport: Reddit OAuth (application-only)');
  }

  // 1) Fetch every feed sequentially with polite pacing.
  const collected: RedditItem[] = [];
  let okFeeds = 0;
  for (const feed of feeds) {
    try {
      const items = token ? await fetchFeedOauth(feed, token) : await fetchFeedRss(feed);
      okFeeds++;
      collected.push(...items);
      console.log(`  ✓ ${feed.label}: ${items.length} items`);
    } catch (e) {
      console.log(`  ✗ ${feed.label}: ${e instanceof Error ? e.message : e}`);
    }
    await sleep(token ? 600 : 12_000);
  }
  if (okFeeds === 0) die('every feed fetch failed — Reddit auth/connectivity is broken, not a quiet day');

  // 2) Filter + score. Dedupe within the run (search results overlap sub feeds).
  const seen = new Set<string>();
  const scored: ScoredItem[] = [];
  const feedSubOf = new Map<string, Pick<SubredditConfig, 'geoImplied'>>();
  for (const s of SUBREDDITS) feedSubOf.set(s.name.toLowerCase(), s);

  for (const item of collected) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    if (ageHours(item, now) > LOOKBACK) continue;
    if (isExcludedAuthor(item.author)) continue;
    if (isExcludedTitle(item.title)) continue;
    // Geo gate uses the item's OWN sub config when we watch it; items surfaced
    // by search from unlisted subs get the lenient gate (already brand-targeted).
    const subCfg = feedSubOf.get(item.subreddit.toLowerCase()) ?? { geoImplied: true };
    const hit = scoreItem(item, subCfg);
    if (hit) scored.push(hit);
  }

  scored.sort((a, b) => {
    if ((a.category === 'brand_watch') !== (b.category === 'brand_watch')) return a.category === 'brand_watch' ? -1 : 1;
    if (b.score !== a.score) return b.score - a.score;
    return b.createdUtc.getTime() - a.createdUtc.getTime();
  });

  console.log(`  ${collected.length} items fetched → ${scored.length} candidates in window`);
  for (const s of scored.slice(0, 30)) {
    console.log(`   · [${s.category}] ${s.score}pts r/${s.subreddit} ${s.kind} — ${s.title.slice(0, 90)}`);
  }

  if (PREVIEW_PATH) {
    fs.writeFileSync(PREVIEW_PATH, renderDigestHtml(scored.slice(0, MAX_DIGEST), Math.max(0, scored.length - MAX_DIGEST), now));
    console.log(`  preview digest written to ${PREVIEW_PATH}`);
  }

  if (!APPLY) {
    // A dry run that skipped drafting was previewing the least interesting half
    // of the job: which threads got found, but not what would be said on them.
    // --drafts generates for real and prints to the console, so the prompt can be
    // tuned (mainly the skip rate) without spending Telegram messages, marking
    // anything seen, or burning the dedupe on threads you have not read yet.
    if (DRAFTS) {
      const preview = scored.slice(0, MAX_DIGEST);
      await applyDrafts(preview);
      for (const item of preview) {
        const cfg = SUBREDDITS.find((s) => s.name.toLowerCase() === item.subreddit.toLowerCase());
        const warmup = isProductFree(cfg);
        console.log(`\n${'─'.repeat(72)}`);
        console.log(`r/${item.subreddit} · ${item.categoryLabel} · ${item.score}pts · warmup=${warmup}`);
        console.log(`TITLE: ${item.title.slice(0, 120)}`);
        if (item.draftSkip) console.log(`SKIP:  ${item.draftReason}`);
        else {
          if (item.draftReason) console.log(`WHY:   ${item.draftReason}`);
          console.log(`DRAFT: ${item.draftPersonal}`);
        }
        if (item.draftFailed) console.log(`FAILED: ${item.draftReason}`);
      }
      console.log(`\n${'─'.repeat(72)}`);
    }
    console.log('  dry-run: no DB writes, no email (DB dedupe not consulted — counts above include already-seen items). Re-run with --apply.');
    return;
  }

  // 3) Record candidates; only never-before-seen rows proceed to email.
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) die('missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const rows = scored.map((s) => ({
    id: s.id,
    kind: s.kind,
    subreddit: s.subreddit,
    author: s.author,
    title: s.title.slice(0, 500),
    excerpt: s.body.slice(0, 1000),
    url: s.permalink,
    category: s.category,
    score: s.score,
    triggers: s.triggers.slice(0, 20),
    city: s.city,
    created_utc: s.createdUtc.toISOString(),
  }));

  if (rows.length > 0) {
    const { error } = await sb
      .from('reddit_opportunities')
      .upsert(rows, { onConflict: 'id', ignoreDuplicates: true });
    if (error) die(`reddit_opportunities insert failed: ${error.message} (is migration 093 applied?)`);
  }

  // Email everything still status 'new' — this run's finds PLUS any earlier rows
  // whose digest failed to send, so a transient email outage never loses a lead.
  const { data: pending, error: pendErr } = await sb
    .from('reddit_opportunities')
    .select('id, kind, subreddit, author, title, excerpt, url, category, score, triggers, city, created_utc')
    .eq('status', 'new')
    .order('score', { ascending: false })
    .order('created_utc', { ascending: false });
  if (pendErr) die(`pending-opportunity query failed: ${pendErr.message}`);

  const toScored = (r: NonNullable<typeof pending>[number]): ScoredItem => {
    const tpl = TEMPLATES[r.category] ?? TEMPLATES.tool_rec;
    return {
      id: r.id,
      kind: r.kind as ScoredItem['kind'],
      subreddit: r.subreddit,
      author: r.author,
      title: r.title ?? '',
      body: r.excerpt ?? '',
      permalink: r.url,
      createdUtc: new Date(r.created_utc),
      category: r.category,
      categoryLabel: CATEGORIES.find((c) => c.id === r.category)?.label ?? r.category,
      score: Number(r.score),
      triggers: r.triggers ?? [],
      city: r.city,
      draftPersonal: fillTemplate(tpl.personal, r.city),
      draftCompany: fillTemplate(tpl.company, r.city),
    };
  };
  const fresh = (pending ?? []).map(toScored);
  const emailItems = fresh.slice(0, MAX_DIGEST);
  const overflow = fresh.slice(MAX_DIGEST);
  console.log(`  ${fresh.length} pending (never emailed) · emailing ${emailItems.length} · overflow ${overflow.length}`);

  if (overflow.length > 0) {
    const { error } = await sb
      .from('reddit_opportunities')
      .update({ status: 'overflow' })
      .in('id', overflow.map((s) => s.id));
    if (error) console.log(`  (non-fatal) overflow status update failed: ${error.message}`);
  }

  if (emailItems.length === 0) {
    console.log('✅ nothing new this cycle — no digest sent.');
    return;
  }

  // 3b) Rewrite each draft from the actual thread.
  //
  // Runs AFTER dedupe and the per-digest cap, so cost tracks alerts delivered
  // rather than candidates scored — a sweep that finds 40 already-seen threads
  // spends nothing. Failures fall back to the template draft rather than dropping
  // the alert.
  await applyDrafts(emailItems);

  // 4) Deliver.
  //
  // Telegram is the primary channel and email the optional second. A Reddit reply
  // is worth most inside the first couple of hours, and a phone notification gets
  // acted on where a digest buried in the inbox gets read the next morning.
  //
  // Either channel alone is enough to consider the batch delivered. What is NOT
  // allowed is marking rows delivered when nothing actually went out — the dedupe
  // table's whole job is that a lead is never shown twice, and never dropped once.
  const useTelegram = telegramConfigured();
  const useEmail = Boolean(process.env.RESEND_API_KEY && TO);

  if (!useTelegram && !useEmail) {
    die(
      'new opportunities found but no delivery channel configured — set TELEGRAM_BOT_TOKEN + ' +
        'TELEGRAM_CHAT_ID, or RESEND_API_KEY + MARKETING_ALERT_EMAIL. Refusing to mark them sent.',
    );
  }

  let delivered = false;

  if (useTelegram) {
    const { sent, errors } = await sendTelegramDigest(emailItems, overflow.length, now, policyFor);
    if (sent > 0) delivered = true;
    if (errors.length) {
      console.log(`  (telegram) ${errors.length} message(s) failed: ${errors.slice(0, 3).join(' | ')}`);
    }
    console.log(`  telegram: ${sent}/${emailItems.length} sent`);
    // A partial send must not mark the unsent ones delivered, so on any failure we
    // keep the whole batch pending and let the next run retry. Re-showing a couple
    // of already-seen threads is a far cheaper error than silently losing leads.
    if (sent < emailItems.length) {
      die(
        `telegram delivered only ${sent}/${emailItems.length} — rows stay status 'new' and will retry next run`,
      );
    }
  }

  if (useEmail) {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { error: mailErr } = await resend.emails.send({
      from: FROM,
      to: TO,
      subject: `🎯 PureProperty · ${emailItems.length} Reddit ${emailItems.length === 1 ? 'opportunity' : 'opportunities'}`,
      html: renderDigestHtml(emailItems, overflow.length, now),
      text: renderDigestText(emailItems, overflow.length, now),
    });
    if (mailErr) {
      // Only fatal when email is the ONLY channel; otherwise Telegram already
      // delivered and failing the run would re-notify everything next cycle.
      if (!delivered) die(`digest email failed: ${mailErr.message} — rows stay status 'new' and will retry next run`);
      console.log(`  (non-fatal) digest email failed: ${mailErr.message}`);
    } else {
      delivered = true;
    }
  }

  if (!delivered) die('no channel delivered — rows stay status \'new\' and will retry next run');

  const { error: markErr } = await sb
    .from('reddit_opportunities')
    .update({ status: 'emailed', emailed_at: now.toISOString() })
    .in('id', emailItems.map((s) => s.id));
  if (markErr) console.log(`  (non-fatal) sent-status update failed: ${markErr.message}`);

  console.log(`✅ ${emailItems.length} opportunities delivered.`);
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)));
