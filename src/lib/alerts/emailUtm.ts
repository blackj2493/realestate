/**
 * Tag every pureproperty.ca link in an outgoing email with UTM parameters.
 *
 * WHY (2026-11-03). PostHog showed that return visits mostly land on listing pages — where
 * the nightly digest links — yet 228 of ~390 return days arrived as "direct": the digest's
 * links carried no tags, so we could not tell which emails bring people back. Only the Data
 * Drop and Street Recap were tagged, each by hand. Tagging here, at the one function every
 * user email passes through, covers every current and future email at once.
 *
 * Rules:
 * - Only links to our own site are tagged (www or apex pureproperty.ca, or SITE).
 * - A link that already has `utm_source` is left alone (hand-tagged emails keep theirs).
 * - `/api/` links are never touched: they carry HMAC-signed parameters (unsubscribe, email
 *   frequency) and adding parameters to them is pointless at best.
 * - Owner/internal mail (`notification:*`, `daily-metrics`) is not tagged.
 * - utm_source = the email kind ("watchlist-digest", "listing-alert", "welcome", …, a ":"
 *   becomes "-"), utm_medium = email, utm_content = what the link points at.
 */

import { SITE } from "./emailShell";

const OWN_HOSTS = new Set(["pureproperty.ca", "www.pureproperty.ca"]);
try {
  OWN_HOSTS.add(new URL(SITE).host);
} catch {
  /* SITE is always a full URL in practice */
}

export function shouldTagKind(kind: string): boolean {
  return !kind.startsWith("notification:") && kind !== "daily-metrics";
}

/** What a link points at, for utm_content. */
export function linkContent(pathname: string): string {
  if (/^\/properties\/[A-Z]\d{6,9}/.test(pathname) || /^\/property\/on\//.test(pathname)) return "listing";
  if (pathname.startsWith("/address/")) return "address";
  if (pathname.startsWith("/dashboard")) return "dashboard";
  if (pathname === "/properties") return "map";
  if (pathname.startsWith("/analytics")) return "market-trends";
  if (pathname.startsWith("/data")) return "data";
  if (pathname === "/" || pathname === "") return "home";
  return "other";
}

/** Tag one URL string; returns it unchanged when it must not be tagged. */
export function tagUrl(raw: string, kind: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return raw;
  }
  if (!OWN_HOSTS.has(u.host)) return raw;
  if (u.pathname.startsWith("/api/")) return raw;
  if (u.searchParams.has("utm_source")) return raw;
  u.searchParams.set("utm_source", kind.replace(/:/g, "-"));
  u.searchParams.set("utm_medium", "email");
  u.searchParams.set("utm_content", linkContent(u.pathname));
  return u.toString();
}

const HREF_RE = /href=(["'])(https?:\/\/[^"']+)\1/g;
// Bare URLs in the plain-text part; stops at whitespace and closing brackets/quotes.
const TEXT_URL_RE = /https?:\/\/[^\s<>"')\]]+/g;

export function tagEmailLinks(
  kind: string,
  html: string | undefined,
  text: string | undefined,
): { html: string | undefined; text: string | undefined } {
  if (!shouldTagKind(kind)) return { html, text };
  const tagHref = (h: string) =>
    h.replace(HREF_RE, (_m, q: string, url: string) => {
      // HTML attributes hold `&amp;`; decode for parsing, re-encode on the way out.
      const decoded = url.replace(/&amp;/g, "&");
      const tagged = tagUrl(decoded, kind);
      return `href=${q}${tagged === decoded ? url : tagged.replace(/&/g, "&amp;")}${q}`;
    });
  return {
    html: html === undefined ? undefined : tagHref(html),
    text: text === undefined ? undefined : text.replace(TEXT_URL_RE, (url) => tagUrl(url, kind)),
  };
}
