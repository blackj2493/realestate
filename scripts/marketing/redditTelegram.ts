/**
 * Telegram delivery for the Reddit opportunity monitor.
 *
 * WHY TELEGRAM AND NOT (ONLY) EMAIL: a Reddit reply is worth far more inside the
 * first couple of hours, and an email digest competes with everything else in the
 * inbox. A phone notification you can act on in thirty seconds is the difference
 * between replying while the thread is live and reading it the next morning.
 *
 * ONE MESSAGE PER OPPORTUNITY, not one digest. Each message is a single thing to
 * act on and carries its own link — a combined digest means scrolling back up to
 * find which link went with which thread, and Telegram caps a message at 4096
 * characters anyway.
 *
 * THE DRAFTS ARE FRAGMENTS ON PURPOSE. They are prompts for what to say, not text
 * to paste. Reddit readers spot generated prose easily now, and being caught
 * posting it as a business costs more than the minutes it saves. The value here is
 * that the thread was found and the number is already to hand — the sentence
 * should still be yours.
 *
 * Env: TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID (from @BotFather; the chat id only
 * exists once you have messaged the bot, since bots cannot open a conversation).
 */
import type { ScoredItem } from './redditMonitorCore';

const API = 'https://api.telegram.org';

/** Telegram hard-caps a message at 4096 chars; leave room for the wrapper. */
const MAX_BODY = 400;
const MAX_DRAFT = 600;

export function telegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

/** Telegram's HTML parse mode only needs these three escaped. */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function truncate(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
}

function ageLabel(created: Date, now: Date): string {
  const mins = Math.max(0, Math.round((now.getTime() - created.getTime()) / 60_000));
  if (mins < 60) return `${mins}m old`;
  const hrs = Math.round(mins / 60);
  return hrs < 48 ? `${hrs}h old` : `${Math.round(hrs / 24)}d old`;
}

/**
 * Compose one opportunity. Ordered for a phone: what/where first, then whether it
 * is still worth replying to, then the substance, then the link last so the thumb
 * lands on it.
 */
export function renderTelegramMessage(
  item: ScoredItem,
  now: Date,
  policyNote: string,
  compliance?: string,
): string {
  const lines: string[] = [];

  lines.push(`<b>r/${esc(item.subreddit)}</b> · ${esc(item.categoryLabel)} · score ${item.score}`);
  lines.push(`${esc(ageLabel(item.createdUtc, now))} · ${item.kind} by u/${esc(item.author)}`);
  lines.push('');
  lines.push(`<b>${esc(truncate(item.title, 160))}</b>`);

  if (item.body.trim()) {
    lines.push('');
    lines.push(`<i>${esc(truncate(item.body, MAX_BODY))}</i>`);
  }

  if (item.triggers.length) {
    lines.push('');
    lines.push(`<b>Matched:</b> ${esc(item.triggers.slice(0, 4).join(', '))}`);
  }
  if (item.city) lines.push(`<b>City:</b> ${esc(item.city)}`);

  lines.push('');
  lines.push(`⚠️ <b>${esc(policyNote)}</b>`);

  // Sits directly above the draft, not up with the policy chip. A constraint that
  // changes what may legally be said has to be the last thing read before the text
  // is copied, or it gets scrolled past on a phone.
  if (compliance) {
    lines.push('');
    lines.push(`🛑 <b>${esc(compliance)}</b>`);
  }

  lines.push('');
  lines.push('<b>Draft reply</b> (tap to copy, then change a few words):');
  // <pre> renders as a tap-to-copy block in Telegram clients, which is the whole
  // point — the draft has to be one tap from the reply box or this gets skipped.
  lines.push(`<pre>${esc(truncate(item.draftPersonal, MAX_DRAFT))}</pre>`);

  lines.push('');
  lines.push(`<a href="${esc(item.permalink)}">Open thread →</a>`);

  return lines.join('\n');
}

async function post(method: string, payload: unknown): Promise<{ ok: boolean; error?: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(`${API}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    const json = (await res.json()) as { ok?: boolean; description?: string };
    if (!res.ok || !json.ok) return { ok: false, error: json.description ?? `HTTP ${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Send every item, then a one-line tail if some were held back.
 *
 * Returns how many landed. The caller must NOT mark anything delivered unless the
 * count matches — a run that half-sends and then marks everything done silently
 * loses the remainder, and the whole point of the dedupe table is that a lead is
 * never shown twice OR dropped once.
 */
export async function sendTelegramDigest(
  items: ScoredItem[],
  overflow: number,
  now: Date,
  policyFor: (subreddit: string) => { policy: string; note: string; compliance?: string },
): Promise<{ sent: number; errors: string[] }> {
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const errors: string[] = [];
  let sent = 0;

  for (const item of items) {
    const { note, compliance } = policyFor(item.subreddit);
    const r = await post('sendMessage', {
      chat_id: chatId,
      text: renderTelegramMessage(item, now, note, compliance),
      parse_mode: 'HTML',
      // The preview would push the actionable text off the first screen.
      link_preview_options: { is_disabled: true },
    });
    if (r.ok) sent++;
    else errors.push(`${item.id}: ${r.error}`);
    // Telegram tolerates ~30/s but throttles bursts to the same chat; this is a
    // handful of messages every half hour, so there is nothing to gain by rushing.
    await new Promise((res) => setTimeout(res, 1200));
  }

  if (overflow > 0 && sent > 0) {
    await post('sendMessage', {
      chat_id: chatId,
      text: `➕ ${overflow} more held back this cycle — they will arrive next run.`,
      parse_mode: 'HTML',
    });
  }

  return { sent, errors };
}
