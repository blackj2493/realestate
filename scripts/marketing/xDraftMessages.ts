/**
 * Render parsed X drafts into Telegram messages.
 *
 * ONE MESSAGE PER DRAFT, the same shape the Reddit monitor settled on. Each message is a
 * single thing to act on and carries its own post text, so posting is select-and-copy
 * rather than scrolling back to work out which chart went with which claim.
 *
 * THE POST TEXT IS NEVER TOUCHED. It is escaped for HTML and otherwise passed through
 * byte for byte — no re-wrapping, no trimming, no "tidying". ROUTINE.md's first hard rule
 * is that figures are cited exactly as given, and a delivery layer that reflows a post is
 * a delivery layer that can change a number. Only the chart spec, which is a note to the
 * human and not publishable text, is allowed to be truncated.
 *
 * The order matters: post first, because it is what gets pasted; then alt text, which X
 * asks for in a separate box; then the chart spec, which is work to do before either.
 */

import { escapeTelegramHtml, TELEGRAM_MAX_CHARS } from './telegram';
import type { XDraft } from './xDraftParse';

/** Leave room for Telegram's own overhead and for the trailing note. */
const BUDGET = TELEGRAM_MAX_CHARS - 200;

/** Cut on a line boundary where possible, and always say that it was cut. */
export function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const nl = cut.lastIndexOf('\n');
  return `${(nl > max * 0.6 ? cut.slice(0, nl) : cut).trimEnd()}\n… (truncated — full text in the PR)`;
}

export function renderDraftMessage(
  draft: XDraft,
  index: number,
  total: number,
  prUrl: string,
): string {
  const esc = escapeTelegramHtml;
  const format = draft.format ? ` · ${esc(draft.format)}` : '';
  const lines: string[] = [
    `📊 <b>X DRAFT ${index}/${total}</b>${format}`,
    esc(draft.title),
    '',
  ];

  if (draft.post) {
    lines.push('<b>POST — paste as-is</b>', `<pre>${esc(draft.post)}</pre>`);
  } else {
    // Say so rather than send a message that looks complete and is not. Angle 3 of
    // 2026-09-07 legitimately has none: its post lives in the day's pick block.
    lines.push('<b>POST</b>', '<i>None in this angle — see the pick message above.</i>');
  }

  if (draft.altText) {
    lines.push('', '<b>ALT TEXT — required</b>', `<pre>${esc(draft.altText)}</pre>`);
  }

  if (draft.chartSpec) {
    // The one field that may be shortened: it is instructions to you, not publishable text.
    const room = BUDGET - lines.join('\n').length;
    lines.push('', '<b>CHART</b>', esc(clip(draft.chartSpec, Math.max(200, room))));
  }

  lines.push('', prUrl);
  return clip(lines.join('\n'), TELEGRAM_MAX_CHARS);
}

/**
 * The routine's own recommendation, quoted rather than summarised.
 *
 * On some days this block already contains the finished chart spec, post and alt text for
 * the angle it picks, which is why it leads and why it is sent whole.
 */
export function renderPickMessage(pick: string, date: string, prUrl: string): string {
  const esc = escapeTelegramHtml;
  const head = `⭐ <b>POST THIS ONE TODAY</b> · ${esc(date)}\n\n`;
  const tail = `\n\n${prUrl}`;
  return head + esc(clip(pick, BUDGET - head.length - tail.length)) + tail;
}

/**
 * Drift report.
 *
 * Sent only when there is something to say, and never suppressed when there is: a thin
 * delivery and a quiet day look identical on a phone, so the one case that must never be
 * silent is the parser failing to find what it expected.
 */
export function renderWarningMessage(warnings: string[], prUrl: string): string {
  const esc = escapeTelegramHtml;
  return [
    '⚠️ <b>Draft file did not parse cleanly</b>',
    'The routine may have changed shape — open the PR and check what is missing.',
    '',
    ...warnings.map((w) => `• ${esc(w)}`),
    '',
    prUrl,
  ].join('\n');
}
