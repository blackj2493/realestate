/**
 * Per-build id baked into the client so the service worker registers as /sw.js?v=<id>:
 * a new deploy is a new worker, and the old cache is dropped on activate. Vercel's
 * commit SHA in production; a timestamp locally so `next build && next start` never
 * serves a stale worker.
 */
const BUILD_ID = (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 12) || `local-${Date.now()}`;

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: { NEXT_PUBLIC_BUILD_ID: BUILD_ID },
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
  async headers() {
    return [
      {
        // The service worker script must never be served stale: the browser re-fetches
        // it to detect a new build, and a CDN-cached copy would hide the update (and the
        // kill switch) until it expired.
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
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