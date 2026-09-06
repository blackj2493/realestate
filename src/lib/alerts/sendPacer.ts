/**
 * sendPacer — the batch send path for the nightly workers.
 *
 * WHY THIS EXISTS (incident 2026-09-03 → 09-06). `scripts/worker/alerts.ts` sent every
 * digest with a bare `resend.emails.send()` inside a try/catch. Two things were wrong and
 * they compounded:
 *
 *  1. The SDK returns API errors in `{ error }` — it does NOT throw. So the catch never
 *     fired, `emailed++` ran on a rejected send, and the watermark advanced. The alert was
 *     not delayed, it was destroyed: the row now believes the user was told.
 *  2. The loop fired with no pacing. Resend accepted ~10/second for ~10 seconds and
 *     rejected the rest, so the tail of every batch was lost.
 *
 * Measured: 124 claimed / 87 accepted (Sep 3), 124 / 86 (Sep 5), 122 / 89 (Sep 6). About a
 * third of subscribers silently received nothing while the run reported success.
 *
 * So this module paces the batch, retries what is worth retrying, and — the part that
 * actually matters — reports a THREE-state outcome so a caller can never mistake a
 * rejection for a delivery. Sends go through `sendTransactionalEmail`, which is the
 * repo's single observable send path: it checks `error`, logs, and records a durable row
 * in `email_send_failures`.
 *
 * The quota state is separate from failure on purpose. A rate limit means "slow down" and
 * is worth retrying; an exhausted daily quota means every remaining send in this batch
 * will fail too, so the pacer latches and short-circuits instead of burning hundreds of
 * requests to collect hundreds of identical errors. Callers should stop the batch and
 * leave the remaining watermarks alone, so tonight's misses go out tomorrow.
 */
import { sendTransactionalEmail, type SendEmailInput } from "@/lib/alerts/sendEmail";

export type SendOutcome =
  | { status: "sent"; id?: string }
  /** Rejected. The caller MUST NOT advance a watermark — this send retries tomorrow. */
  | { status: "failed"; error: string }
  /** The provider is out of quota. Every further send tonight will fail; stop the batch. */
  | { status: "quota"; error: string };

export interface SendPacerStats {
  sent: number;
  failed: number;
  /** Individual attempts retried after a retryable error (not distinct recipients). */
  retries: number;
  /** Sends short-circuited after the quota latched, never attempted. */
  skippedAfterQuota: number;
  quotaHit: boolean;
}

export interface SendPacer {
  send(input: SendEmailInput): Promise<SendOutcome>;
  /** True once a quota error latched — the caller should break out of its loop. */
  readonly stopped: boolean;
  stats(): SendPacerStats;
}

/**
 * Resend's documented default is 2 requests/second. We observed ~10/s being accepted
 * before rejection, so 2 is deliberately below the cliff rather than at it: the retry
 * ladder is the safety net, not the strategy. Raise it with RESEND_SENDS_PER_SECOND once
 * the plan's limit is known to be higher.
 */
const DEFAULT_PER_SECOND = 2;
const DEFAULT_MAX_RETRIES = 3;

/** "slow down / try again" — worth another attempt inside the same run. */
function isRetryable(reason: string): boolean {
  return /rate.?limit|too.?many.?requests|\b429\b|\b5\d\d\b|timeout|timed out|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|fetch failed/i.test(
    reason
  );
}

/**
 * "you have no allowance left" — retrying cannot help, and neither can the next 200 sends.
 * Checked BEFORE isRetryable because Resend's quota errors are themselves a kind of limit
 * error and would otherwise be retried three times each, all the way down the batch.
 */
function isQuota(reason: string): boolean {
  return /quota|daily limit|monthly limit|plan limit|upgrade your plan/i.test(reason);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface SendPacerOptions {
  perSecond?: number;
  maxRetries?: number;
  /** Injected in tests. */
  send?: typeof sendTransactionalEmail;
  now?: () => number;
  wait?: (ms: number) => Promise<void>;
}

export function createSendPacer(opts: SendPacerOptions = {}): SendPacer {
  const envRate = Number(process.env.RESEND_SENDS_PER_SECOND);
  const perSecond =
    opts.perSecond ?? (Number.isFinite(envRate) && envRate > 0 ? envRate : DEFAULT_PER_SECOND);
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const doSend = opts.send ?? sendTransactionalEmail;
  const now = opts.now ?? (() => Date.now());
  const wait = opts.wait ?? sleep;

  const intervalMs = 1000 / perSecond;
  let nextSlot = 0;
  let quotaHit = false;
  const stats: SendPacerStats = {
    sent: 0,
    failed: 0,
    retries: 0,
    skippedAfterQuota: 0,
    quotaHit: false,
  };

  /** Space attempts by intervalMs without accumulating drift on a slow send. */
  async function takeSlot(): Promise<void> {
    const t = now();
    if (t < nextSlot) await wait(nextSlot - t);
    nextSlot = Math.max(nextSlot, now()) + intervalMs;
  }

  return {
    get stopped() {
      return quotaHit;
    },
    stats: () => ({ ...stats, quotaHit }),
    async send(input: SendEmailInput): Promise<SendOutcome> {
      if (quotaHit) {
        stats.skippedAfterQuota++;
        return { status: "quota", error: "daily quota already exhausted this run" };
      }

      let lastError = "unknown";
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        await takeSlot();
        const res = await doSend(input);
        if (res.sent) {
          stats.sent++;
          return { status: "sent", id: res.id };
        }
        lastError = res.error ?? "unknown";

        if (isQuota(lastError)) {
          quotaHit = true;
          stats.quotaHit = true;
          stats.failed++;
          console.error(
            `[sendPacer] QUOTA EXHAUSTED after ${stats.sent} sent — stopping the batch. ${lastError}`
          );
          return { status: "quota", error: lastError };
        }
        if (!isRetryable(lastError) || attempt === maxRetries) break;

        stats.retries++;
        await wait(Math.min(1000 * 2 ** attempt, 8000)); // 1s, 2s, 4s
      }

      stats.failed++;
      return { status: "failed", error: lastError };
    },
  };
}
