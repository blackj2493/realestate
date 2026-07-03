/**
 * Signed unsubscribe tokens for CASL-compliant one-click unsubscribe links.
 *
 * We HMAC the user id so the /api/email/unsubscribe link can't be forged to
 * opt-out an arbitrary account. Server-only (never shipped to the client).
 *
 * Key: EMAIL_LINK_SECRET if set, else the service-role key (server-only secret,
 * already required for every mailer). Set a dedicated EMAIL_LINK_SECRET later to
 * decouple; existing links keep working only if the key is unchanged, so rotate
 * deliberately.
 */

import { createHmac, timingSafeEqual } from "crypto";

function secret(): string {
  const s = process.env.EMAIL_LINK_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!s) throw new Error("No EMAIL_LINK_SECRET / SUPABASE_SERVICE_ROLE_KEY for email token signing");
  return s;
}

/** Deterministic HMAC-SHA256 (hex) of `unsubscribe:<userId>`. */
export function signUnsubscribe(userId: string): string {
  return createHmac("sha256", secret()).update(`unsubscribe:${userId}`).digest("hex");
}

/** Constant-time verification of an unsubscribe token. */
export function verifyUnsubscribe(userId: string, token: string): boolean {
  if (!userId || !token) return false;
  const expected = signUnsubscribe(userId);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(token, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
