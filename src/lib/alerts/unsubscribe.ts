/**
 * One-click unsubscribe tokens for anonymous listing-alert emails.
 *
 * These subscribers have no account, so unsubscribe is an HMAC-signed link keyed off the
 * email — no per-row token column, no lookup: the worker signs the link, the web route
 * (/api/listing-alerts/unsubscribe) recomputes and verifies it, then flips every row for
 * that email to `unsubscribed`. HMAC is one-way, so signing with the service-role key
 * doesn't expose it; using an already-present secret avoids a new env var in two runtimes
 * (the tsx worker + the Next route). Set ALERTS_UNSUBSCRIBE_SECRET to rotate independently.
 */

import { createHmac, timingSafeEqual } from "crypto";

function secret(): string {
  const s = process.env.ALERTS_UNSUBSCRIBE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!s) throw new Error("No unsubscribe secret (ALERTS_UNSUBSCRIBE_SECRET or SUPABASE_SERVICE_ROLE_KEY)");
  return s;
}

const normEmail = (email: string): string => (email || "").trim().toLowerCase();

/** URL-safe HMAC-SHA256 of the normalized email. */
export function signUnsubscribe(email: string): string {
  return createHmac("sha256", secret()).update(normEmail(email)).digest("base64url");
}

/** Constant-time verification; false on any mismatch or missing input. */
export function verifyUnsubscribe(email: string, sig: string): boolean {
  if (!email || !sig) return false;
  const expected = Buffer.from(signUnsubscribe(email));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Absolute unsubscribe URL embedded in every listing-alert email (and its List-Unsubscribe header). */
export function unsubscribeUrl(email: string, siteUrl: string): string {
  const base = (siteUrl || "https://www.pureproperty.ca").replace(/\/$/, "");
  const e = encodeURIComponent(normEmail(email));
  const s = encodeURIComponent(signUnsubscribe(email));
  return `${base}/api/listing-alerts/unsubscribe?e=${e}&s=${s}`;
}
