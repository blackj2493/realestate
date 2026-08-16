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
 * THE DRAFT IS A STARTING POINT, NOT A SCRIPT. Change a few words before posting.
 * Reddit readers spot generated prose easily now, and being caught posting it as a
 * business costs more than the minutes it saves.
 *
 * The header states which mode produced the draft, because that is the difference
 * between a comment that earns standing and one that spends standing you have not
 * built yet. In warmup the draft names nothing and links nothing; outside it the
 * header is flagged so a promotional draft can never be posted by reflex.
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
  warmup = true,
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
  lines.push(
    warmup
      ? '<b>Draft reply</b> — warmup mode, no brand or link. Tap to copy, then change a few words:'
      : '<b>Draft reply</b> ⚑ NAMES THE SITE — only send this if the sub and your history there both allow it:',
  );
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
  policyFor: (subreddit: string) => {
    policy: string;
    note: string;
    compliance?: string;
    warmup?: boolean;
  },
): Promise<{ sent: number; errors: string[] }> {
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const errors: string[] = [];
  let sent = 0;

  for (const original of items) {
    const { note, compliance, warmup } = policyFor(original.subreddit);

    // Belt and braces: the header claims warmup, so the body must actually BE
    // product-free. A mismatch shipped once — alerts labelled "warmup mode, no
    // brand or link" carrying the promotional template, because tsx served a
    // stale transpile of the module that picks the draft. The failure is silent
    // and expensive, since it invites posting promo from an account with no
    // standing. Cheaper to check here than to trust the layer above.
    let item = original;
    if ((warmup ?? true) && /pureproperty|https?:\/\//i.test(item.draftPersonal)) {
      errors.push(`${item.id}: draft labelled warmup but contains brand/link — suppressed`);
      item = {
        ...item,
        draftPersonal: '[draft suppressed — promotional text reached warmup mode. Write this one yourself.]',
      };
    }

    const r = await post('sendMessage', {
      chat_id: chatId,
      text: renderTelegramMessage(item, now, note, compliance, warmup ?? true),
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
