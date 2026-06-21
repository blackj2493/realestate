/**
 * /sitemap-addresses.xml — a SEPARATE sitemap for the public /address (sold/off-market)
 * pages, kept out of the main sitemap.ts so the already-submitted /sitemap.xml is
 * undisturbed. Sourced from the sold_listings rolling ~180-day window (the freshest,
 * most-searched "recently sold" addresses), capped under the 50k-URL sitemap limit.
 *
 * Contains ONLY address-page URLs — no VOW data. Referenced from robots.ts. Daily
 * revalidate; best-effort (empty urlset on any failure, never a 500 that hides the
 * main sitemap).
 */
import { getSoldSitemapEntries } from "@/lib/sold/soldByKey";
import { cityHubSlug, slugify } from "@/lib/listings/listingPath";

export const revalidate = 86400;

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");
const MAX_URLS = 45_000; // headroom under the 50k-URL sitemap protocol limit

const xmlEscape = (s: string) =>
  s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]!));

export async function GET() {
  let body = "";
  try {
    const entries = await getSoldSitemapEntries(MAX_URLS);
    const urls: string[] = [];
    for (const e of entries) {
      const citySlug = cityHubSlug(e.city) || slugify(e.city);
      if (!citySlug) continue; // can't build a clean URL without a city
      const street = slugify((e.address || "").split(",")[0]);
      const slug = street ? `${street}-${e.id}` : e.id;
      const loc = `${SITE_URL}/address/on/${citySlug}/${slug}`;
      urls.push(`  <url><loc>${xmlEscape(loc)}</loc><changefreq>monthly</changefreq><priority>0.5</priority></url>`);
    }
    body = urls.join("\n");
  } catch (err) {
    console.error("[sitemap-addresses] generation failed:", err);
    body = ""; // emit a valid empty urlset rather than a 500
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>`;
  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=86400, stale-while-revalidate=86400",
    },
  });
}
