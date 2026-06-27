/** @type {import('next').NextConfig} */
const nextConfig = {
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
  images: {
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