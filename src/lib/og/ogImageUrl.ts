/**
 * Builds an absolute URL to the /og dynamic image endpoint. Lightweight + dependency-free
 * (no `next/og` import) so page metadata can import it without pulling the image runtime
 * into the page bundle. Pages set this as `openGraph.images`; Twitter falls back to it.
 */
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");

export function ogImageUrl(opts: { title: string; subtitle?: string; eyebrow?: string }): string {
  const p = new URLSearchParams();
  p.set("title", opts.title);
  if (opts.subtitle) p.set("subtitle", opts.subtitle);
  if (opts.eyebrow) p.set("eyebrow", opts.eyebrow);
  return `${SITE_URL}/og?${p.toString()}`;
}
