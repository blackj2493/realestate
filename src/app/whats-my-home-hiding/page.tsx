import type { Metadata } from 'next';
import Link from 'next/link';
import RenovationFunnel from '@/components/reno/RenovationFunnel';
import { loadCohortTreeSafe } from '@/lib/avm/loadCohortTree';
import { resolveCommunitySlug, deslugifyCommunity } from '@/lib/reno/communitySlug';
import AppHeader from '@/components/layout/AppHeader';

export const dynamic = 'force-dynamic';

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://www.pureproperty.ca').replace(/\/$/, '');

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ community?: string }>;
}): Promise<Metadata> {
  const { community: slug } = await searchParams;
  const where = slug ? deslugifyCommunity(slug) : null;
  const title = where
    ? `Which renovation pays you back most in ${where}?`
    : "What's my home hiding? Renovation upside, free";
  const description = where
    ? `Find the renovation that pays back most for your ${where} home. Free, 60-second analysis.`
    : 'Describe your home and find the renovations that pay back most in your neighbourhood. Free.';
  const ogImage = `/api/og/whats-my-home-hiding${slug ? `?community=${encodeURIComponent(slug)}` : ''}`;

  return {
    metadataBase: new URL(SITE_URL),
    title,
    description,
    openGraph: {
      title,
      description,
      url: `/whats-my-home-hiding${slug ? `?community=${encodeURIComponent(slug)}` : ''}`,
      images: [{ url: ogImage, width: 1200, height: 630 }],
    },
    twitter: { card: 'summary_large_image', title, description, images: [ogImage] },
  };
}

export default async function WhatsMyHomeHidingPage({
  searchParams,
}: {
  searchParams: Promise<{ community?: string }>;
}) {
  const { community: slug } = await searchParams;
  const tree = await loadCohortTreeSafe();
  const resolved = slug ? resolveCommunitySlug(tree, slug) : null;
  const communityLabel = resolved ? deslugifyCommunity(slug!) : null;

  return (
    <div className="min-h-app bg-background text-foreground">
      <AppHeader variant="marketing" />
      <main className="mx-auto max-w-[1200px] px-4 py-10">
        <h1 className="mb-1 text-3xl font-bold text-foreground">What&apos;s my home hiding?</h1>
        <p className="mb-3 max-w-2xl text-sm text-muted-foreground">
          Enter your address and see the renovations that pay back the most where you are —
          ranked by what actually sells nearby. Free.
        </p>
        <p className="mb-8 text-xs text-muted-foreground">
          Want your home&apos;s full estimated value too?{" "}
          <Link
            href="/hidden-equity"
            className="text-cyan-400 underline underline-offset-2 hover:text-cyan-300"
          >
            Sign in for your Hidden Equity report →
          </Link>
        </p>
        <RenovationFunnel
          tree={tree}
          initialCity={resolved?.city ?? ''}
          initialCityRegion={resolved?.cityRegion ?? ''}
          communitySlug={slug ?? null}
          communityLabel={communityLabel}
        />
      </main>
    </div>
  );
}
