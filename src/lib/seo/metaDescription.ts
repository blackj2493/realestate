/**
 * Fit a page summary into a meta description. Bing Webmaster Tools flags a description
 * over 160 characters as an SEO error (2026-11-25: every /data question page was 165-319),
 * and Google cuts the snippet near there anyway.
 *
 * Keeps whole sentences while they fit; when the first sentence alone is too long, cuts at
 * the last word that fits and adds an ellipsis. Only for <meta name="description"> and
 * og/twitter descriptions: JSON-LD and the page itself keep the full text.
 */
export const META_DESCRIPTION_MAX = 160;

export function metaDescription(text: string | null | undefined, max = META_DESCRIPTION_MAX): string {
  const s = (text ?? "").replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  // A sentence ends at . ! or ? followed by a space, so "$1.2M" stays whole.
  let out = "";
  for (const sentence of s.split(/(?<=[.!?])\s+/)) {
    const next = out ? `${out} ${sentence}` : sentence;
    if (next.length > max) break;
    out = next;
  }
  if (out.length >= 50) return out;
  const cut = s.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > 0 ? cut.slice(0, space) : cut).replace(/[\s,;:–—-]+$/, "")}…`;
}
