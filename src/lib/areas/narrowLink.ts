/**
 * Signed link for the "narrow all of Toronto / Ottawa" ask (narrowAsk.ts).
 *
 * The link opens a PAGE (/areas/narrow), never an action. Mail scanners and link
 * prefetchers open every link in an email; the Data Drop "follow" chip can live with that
 * because adding an area is additive and idempotent, but this ask REPLACES an area. So the
 * change happens only when the reader presses a button on the page (a POST), and the
 * signature here only proves which reader and which city the page is about.
 *
 * Same secret as every other email link (unsubscribe.ts), with its own payload prefix so no
 * two link families can collide.
 */
import { timingSafeEqual } from "crypto";
import { signAlertsPayload } from "@/lib/alerts/unsubscribe";

const norm = (s: string) => (s || "").trim().toLowerCase();

export function signNarrow(email: string, city: string): string {
  return signAlertsPayload(`narrow:${norm(city)}:${norm(email)}`);
}

/** Constant-time; false on any mismatch or missing input. */
export function verifyNarrow(email: string, city: string, sig: string): boolean {
  if (!email || !city || !sig) return false;
  const expected = Buffer.from(signNarrow(email, city));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Absolute URL of the narrow page for one reader and city, optionally pre-selecting a part. */
export function narrowPageUrl(email: string, city: string, siteUrl: string, part?: string | null): string {
  const base = (siteUrl || "https://www.pureproperty.ca").replace(/\/$/, "");
  const q = new URLSearchParams({ e: norm(email), c: city, s: signNarrow(email, city) });
  if (part) q.set("p", part);
  return `${base}/areas/narrow?${q.toString()}`;
}
