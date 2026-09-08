/**
 * Deliver today's X drafts to Telegram.
 *
 * THE PROBLEM THIS SOLVES IS DELIVERY, NOT DRAFTING. The daily routine has written X
 * posts for every angle since 2026-08-18 — chart spec, post text, alt text, caveat,
 * compressed disclosure, all to ROUTINE.md's contract. It then opens a PR. Nineteen of
 * those PRs are open and none has ever been merged, so roughly seventy-six finished X
 * posts have never been read by anyone. The Reddit monitor is not better at writing; it
 * just arrives on a phone.
 *
 * So this reads the newest open `content/*` PR, lifts the X sections out of its markdown,
 * and sends them to the same Telegram chat the Reddit alerts already use. Nothing is
 * generated here and nothing is posted to X — the human in the loop is the product, as
 * ROUTINE.md says, and X has no free API to post through anyway.
 *
 * WHY IT READS THE PR AND NOT main. The routine's output never lands on main; that is the
 * whole point. The branch is where the drafts are.
 *
 * DEDUPE IS A PR COMMENT, not a table. It needs to survive a re-run and a manual
 * dispatch, and it needs to be visible when you wonder whether a day went out. A marker
 * comment on the PR does both with no migration and no second writer racing a dedupe
 * table — which is exactly how the Reddit monitor's CI job started losing leads to its
 * local twin (see .github/workflows/reddit-monitor.yml). ONE runner, one marker.
 *
 * Usage:
 *   npx tsx scripts/marketing/xDraftDeliver.ts --dry-run   # print, send nothing
 *   npx tsx scripts/marketing/xDraftDeliver.ts             # send, then mark the PR
 *   npx tsx scripts/marketing/xDraftDeliver.ts --force     # send even if already marked
 *
 * Env: GITHUB_TOKEN (or GH_TOKEN), GITHUB_REPOSITORY (owner/repo),
 *      TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID.
 */

import { telegramConfigured, sendTelegramText } from './telegram';
import { parseXDrafts } from './xDraftParse';
import { renderDraftMessage, renderPickMessage, renderWarningMessage } from './xDraftMessages';

const MARKER = '<!-- x-draft-delivered -->';
const API = 'https://api.github.com';

const dryRun = process.argv.includes('--dry-run');
const force = process.argv.includes('--force');

function token(): string {
  const t = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!t) throw new Error('GITHUB_TOKEN (or GH_TOKEN) is required to read the content PR.');
  return t;
}

function repo(): string {
  const r = process.env.GITHUB_REPOSITORY;
  if (!r) throw new Error('GITHUB_REPOSITORY (owner/repo) is required.');
  return r;
}

async function gh<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: {
      Authorization: `Bearer ${token()}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'pureproperty-x-draft-delivery',
    },
  });
  if (!res.ok) throw new Error(`GitHub ${path} → HTTP ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

interface Pr {
  number: number;
  html_url: string;
  head: { ref: string; sha: string };
  created_at: string;
}

/** The newest open PR whose branch is `content/YYYY-MM-DD`. */
async function newestContentPr(): Promise<Pr | null> {
  const prs = await gh<Pr[]>(`/repos/${repo()}/pulls?state=open&per_page=100&sort=created&direction=desc`);
  const content = prs
    .filter((p) => /^content\/\d{4}-\d{2}-\d{2}$/.test(p.head.ref))
    .sort((a, b) => b.head.ref.localeCompare(a.head.ref));
  return content[0] ?? null;
}

/** The draft markdown for that PR's date, read off its own branch. */
async function draftFile(pr: Pr, date: string): Promise<string> {
  const path = `content-queue/${date}.md`;
  const res = await fetch(`${API}/repos/${repo()}/contents/${path}?ref=${pr.head.sha}`, {
    headers: {
      Authorization: `Bearer ${token()}`,
      Accept: 'application/vnd.github.raw',
      'User-Agent': 'pureproperty-x-draft-delivery',
    },
  });
  if (!res.ok) throw new Error(`Could not read ${path} on ${pr.head.ref}: HTTP ${res.status}`);
  return await res.text();
}

async function alreadyDelivered(pr: Pr): Promise<boolean> {
  const comments = await gh<{ body: string }[]>(
    `/repos/${repo()}/issues/${pr.number}/comments?per_page=100`,
  );
  return comments.some((c) => c.body?.includes(MARKER));
}

async function markDelivered(pr: Pr, sent: number): Promise<void> {
  const res = await fetch(`${API}/repos/${repo()}/issues/${pr.number}/comments`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token()}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'pureproperty-x-draft-delivery',
    },
    body: JSON.stringify({
      body:
        `${MARKER}\n📱 **${sent} X draft message(s) sent to Telegram** at ` +
        `${new Date().toISOString()}.\n\nNothing was posted to X — these are drafts to edit and post by hand.`,
    }),
  });
  // A failed marker means the next run re-sends. Annoying, not harmful, and far better
  // than failing the run after the messages already landed.
  if (!res.ok) console.warn(`[x-drafts] could not mark PR #${pr.number}: HTTP ${res.status}`);
}

async function main(): Promise<void> {
  if (!dryRun && !telegramConfigured()) {
    throw new Error(
      'TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are required. Use --dry-run to preview without them.',
    );
  }

  const pr = await newestContentPr();
  if (!pr) {
    console.log('[x-drafts] No open content/* PR. Nothing to deliver.');
    return;
  }
  const date = pr.head.ref.replace('content/', '');
  console.log(`[x-drafts] newest content PR: #${pr.number} (${pr.head.ref})`);

  if (!dryRun && !force && (await alreadyDelivered(pr))) {
    console.log(`[x-drafts] #${pr.number} already delivered. Use --force to send again.`);
    return;
  }

  const { pick, drafts, warnings } = parseXDrafts(await draftFile(pr, date));
  console.log(`[x-drafts] parsed ${drafts.length} draft(s), ${warnings.length} warning(s)`);

  const messages: string[] = [];
  if (pick) messages.push(renderPickMessage(pick, date, pr.html_url));
  drafts.forEach((d, i) => messages.push(renderDraftMessage(d, i + 1, drafts.length, pr.html_url)));
  // Never suppressed: on a phone a thin delivery and a quiet day look identical, so a
  // parser that found nothing has to say so out loud.
  if (warnings.length) messages.push(renderWarningMessage(warnings, pr.html_url));

  if (!messages.length) {
    console.log('[x-drafts] nothing to send.');
    return;
  }

  if (dryRun) {
    messages.forEach((m, i) => console.log(`\n──────── message ${i + 1}/${messages.length} ────────\n${m}`));
    console.log(`\n[x-drafts] dry run — ${messages.length} message(s) NOT sent.`);
    return;
  }

  let sent = 0;
  const failures: string[] = [];
  for (const m of messages) {
    const r = await sendTelegramText(m);
    if (r.ok) sent++;
    else failures.push(r.error ?? 'unknown');
    // Telegram throttles bursts to one chat; a handful of messages once a day is not
    // worth rushing.
    await new Promise((res) => setTimeout(res, 1200));
  }

  console.log(`[x-drafts] sent ${sent}/${messages.length}`);
  if (sent > 0) await markDelivered(pr, sent);
  if (failures.length) {
    // Exit non-zero so the run goes red and the failure notifier fires. A partial send
    // that reports success is how a channel quietly stops working.
    throw new Error(`${failures.length} message(s) failed: ${failures.join('; ')}`);
  }
}

main().catch((e) => {
  console.error('[x-drafts]', e instanceof Error ? e.message : e);
  process.exit(1);
});
