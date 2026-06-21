import { renderOgImage } from "@/lib/og/ogImage";

/**
 * Dynamic OG/Twitter card endpoint — /og?title=…&eyebrow=…&subtitle=…
 *
 * Collision-proof alternative to file-based opengraph-image.tsx (which clashes with the
 * [neighbourhood] dynamic segment under the city hub). Pages reference this via
 * ogImageUrl() in their openGraph.images; Twitter falls back to og:image. Inputs are
 * length-clamped so the endpoint can't be coerced into rendering arbitrary walls of text.
 *
 * Intentionally dynamic (reads searchParams) — NOT force-static, which would pre-render a
 * single param-less image at build and serve it for every URL. Per-URL caching is handled
 * by the Cache-Control header set in renderOgImage (public, max-age 1d), so the CDN caches
 * each distinct card after its first render.
 */
const clamp = (s: string | null, n: number) => (s ? s.slice(0, n) : undefined);

export function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const title = clamp(searchParams.get("title"), 90) || "Ontario Real Estate, Decoded";
  const subtitle = clamp(searchParams.get("subtitle"), 150);
  const eyebrow = clamp(searchParams.get("eyebrow"), 40);
  return renderOgImage({ title, subtitle, eyebrow });
}
