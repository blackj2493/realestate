/**
 * sendTransactionalEmail — the single, OBSERVABLE send path for every transactional email
 * the web app (Vercel runtime) sends.
 *
 * It exists because the welcome email silently failed for weeks (2026-07): the Vercel
 * RESEND_API_KEY value was wrong, and NOTHING surfaced it. Two silent-failure holes this
 * closes:
 *   1. Missing key → the old code did `if (!RESEND_API_KEY) return;` (or skipped the block)
 *      with no log and no record.
 *   2. resend.emails.send() does NOT throw on an API error — a bad-key 401 is returned in
 *      `{ error }`, not raised. No call-site checked that field, so a wrong key looked
 *      exactly like success. THIS is what hid the incident.
 *
 * So this wrapper: checks the returned `error` (not just exceptions), logs every miss with a
 * loud greppable prefix, and records a durable row in email_send_failures (migration 098) —
 * read by the nightly data-health canary, which alerts from GitHub Actions (a channel that
 * still works when Vercel's Resend credential is dead; an email alert about broken email is
 * circular).
 *
 * NON-THROWING by contract: transactional sends here are best-effort (a failed email must
 * never fail the lead capture / terms acceptance that triggered it). Callers get a
 * SendResult instead of an exception; the failure is already logged + recorded.
 */
import { Resend } from "resend";
import { getServiceRoleClient } from "@/lib/supabase/client";

export interface SendEmailInput {
  /** Stable label for the email type, e.g. 'welcome', 'confirmation:listing-alerts'. */
  kind: string;
  to: string | string[];
  from: string;
  subject: string;
  /** At least one of html/text (Resend requirement); text-only sends are fine. */
  html?: string;
  text?: string;
  replyTo?: string;
  headers?: Record<string, string>;
}

export interface SendResult {
  sent: boolean;
  id?: string;
  /** 'missing_key' or the (truncated) provider error, when sent === false. */
  error?: string;
}

function domainOf(to: string | string[]): string | null {
  const first = Array.isArray(to) ? to[0] : to;
  const at = (first ?? "").lastIndexOf("@");
  return at >= 0 ? first.slice(at + 1).toLowerCase() : null;
}

/** Best-effort durable record of a miss. MUST NOT throw — observability can't break sends. */
async function recordFailure(kind: string, reason: string, to: string | string[]): Promise<void> {
  try {
    const sb = getServiceRoleClient();
    await sb.from("email_send_failures").insert({
      kind,
      reason: reason.slice(0, 300),
      recipient_domain: domainOf(to),
    });
  } catch (e) {
    // The failures table may not exist yet (pre-098) — never let recording break anything.
    console.error(`[email] could not record failure (${kind}):`, e instanceof Error ? e.message : e);
  }
}

export async function sendTransactionalEmail(input: SendEmailInput): Promise<SendResult> {
  const { kind, to, from, subject, html, text, replyTo, headers } = input;

  if (!process.env.RESEND_API_KEY) {
    // The exact hole that hid the 2026-07 incident: a missing key with no signal.
    console.error(`[email] BLOCKED kind=${kind} reason=missing_key — RESEND_API_KEY not set in this runtime`);
    await recordFailure(kind, "missing_key", to);
    return { sent: false, error: "missing_key" };
  }

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    // Resend's send type is a union requiring one of html/text/react; we allow text-only, so
    // build the payload and cast at this single boundary rather than fighting the union.
    const payload = { from, to, subject, html, text, replyTo, headers } as Parameters<typeof resend.emails.send>[0];
    // resend returns { data, error }; API errors (auth/validation) come back HERE, not thrown.
    const { data, error } = await resend.emails.send(payload);
    if (error) {
      const reason = `${error.name ?? "error"}: ${error.message ?? String(error)}`;
      console.error(`[email] FAILED kind=${kind}: ${reason}`);
      await recordFailure(kind, reason, to);
      return { sent: false, error: reason };
    }
    return { sent: true, id: data?.id };
  } catch (e) {
    // Network/transport faults DO throw.
    const reason = e instanceof Error ? e.message : String(e);
    console.error(`[email] THREW kind=${kind}: ${reason}`);
    await recordFailure(kind, reason, to);
    return { sent: false, error: reason };
  }
}
