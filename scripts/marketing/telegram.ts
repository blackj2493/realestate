/**
 * Low-level Telegram transport, shared by every marketing alerter.
 *
 * Extracted from redditTelegram.ts when the X draft delivery needed the identical
 * call. Two copies of a fetch-with-timeout that reads two env vars is exactly the kind
 * of duplication that drifts — one gets a retry, the other does not, and the difference
 * only shows up the night one of them is silently dropping messages.
 *
 * Env: TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID (from @BotFather; the chat id only exists
 * once you have messaged the bot, since bots cannot open a conversation).
 */

const API = 'https://api.telegram.org';

/** Telegram hard-caps a message at 4096 characters. */
export const TELEGRAM_MAX_CHARS = 4096;

export function telegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

/** Telegram's HTML parse mode only needs these three escaped. */
export function escapeTelegramHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function postTelegram(
  method: string,
  payload: unknown,
): Promise<{ ok: boolean; error?: string }> {
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

/** One message to the configured chat, with link previews off. */
export async function sendTelegramText(text: string): Promise<{ ok: boolean; error?: string }> {
  return postTelegram('sendMessage', {
    chat_id: process.env.TELEGRAM_CHAT_ID,
    text,
    parse_mode: 'HTML',
    // A preview would push the actionable text off the first screen.
    link_preview_options: { is_disabled: true },
  });
}
