/** @type {import('next').NextConfig} */
const nextConfig = {
  // /sitemap.xml enumerates ~19,700 URLs by paginating Supabase `listings` and
  // faceting Typesense; measured at 63.6s. Next's default static-generation budget is
  // 60s, so the route sat just OVER the line: the build retried it 3 times and failed,
  // and whether any given build went green was luck. It took down the production build
  // for #483 and a preview for an unrelated branch (d262c6f) in the same window, and
  // neither change went anywhere near the sitemap. Raising the budget is the honest
  // fix for a route that is legitimately heavy and revalidates daily; making it cheaper
  // is separate work, tracked in the sitemap's own comment.
  staticPageGenerationTimeout: 300,
  // PostHog reverse proxy. Analytics requests go to /ingest on our own domain and
  // are rewritten server-side to PostHog's US cloud — this defeats the ~20-30% of
  // ad-blockers that block calls to *.posthog.com. `skipTrailingSlashRedirect`
  // keeps PostHog's trailing-slash API paths intact through the rewrite.
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return [
      { source: '/ingest/static/:path*', destination: 'https://us-assets.i.posthog.com/static/:path*' },
      { source: '/ingest/:path*', destination: 'https://us.i.posthog.com/:path*' },
      { source: '/ingest/decide', destination: 'https://us.i.posthog.com/decide' },
    ];
  },
  async redirects() {
    // The terminal map lives at /properties. Older emails/links point at /terminal;
    // keep them working with a permanent (308) redirect.
    return [
      { source: '/terminal', destination: '/properties', permanent: true },
    ];
  },
  images: {
    // TRREB/MLS photos are already pre-sized (`rs:fit:…` variants) and carry a
    // baked-in watermark that IDX §6.3(f) bars us from altering. Routing them
    // through Next's optimizer re-encodes the bytes (watermark-strip risk) AND —
    // because listings turn over daily — churns Vercel's image cache. That churn
    // (transformations + cache writes) was ~77% of our Vercel bill for near-zero
    // benefit on already-optimized source images. Serve original bytes straight
    // from the source CDN. Individual galleries also set `unoptimized` on their
    // <Image> (defense-in-depth); see ListingThumbnail.tsx for the same policy.
    unoptimized: true,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
      },
      {
        protocol: 'https',
        hostname: 'photos.listhub.net',
      },
      {
        protocol: 'https',
        hostname: 'ap.rdcpix.com',
      },
      {
        protocol: 'https',
        hostname: 'trreb-image.ampre.ca',
      },
    ],
  },
};

export default nextConfig;