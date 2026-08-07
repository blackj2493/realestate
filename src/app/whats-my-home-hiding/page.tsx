import type { Metadata } from 'next';
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
    : 'What could a reno add to your home? Renovation payback, ranked';
  const description = where
    ? `PureProperty Intelligence models ${where} on its own closed sales and ranks every renovation by value added per dollar spent — for your property type, in your neighbourhood. Not national reno averages.`
    : 'PureProperty Intelligence models your neighbourhood on its own closed sales and ranks every renovation by value added per dollar spent — for your property type, on your local market. Not national reno averages.';
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
        <h1 className="mb-1.5 text-3xl font-bold text-foreground">
          What could a reno add to your home{communityLabel ? ` in ${communityLabel}` : ''}?
        </h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          Renovation payback is local — what pays back in{' '}
          {communityLabel ?? 'one neighbourhood'} is not what pays back the next one over.{' '}
          <b className="font-semibold text-foreground">PureProperty Intelligence</b> models{' '}
          {communityLabel ?? 'your neighbourhood'} on its own closed sales and ranks every renovation
          by <b className="font-semibold text-foreground">value added per dollar spent</b>, for your
          property type. Not national reno averages, not a contractor&rsquo;s estimate.
        </p>
        {/* The credibility byline: facts about the method, stated as facts. */}
        <ul className="mb-8 mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 font-mono text-[11.5px] text-muted-foreground">
          {[
            communityLabel ? `${communityLabel}'s own closed sales` : 'Your neighbourhood’s own closed sales',
            'Never asking prices',
            'Modelled per property type',
            'Refreshed every 24h',
            'About a minute',
          ].map((chip) => (
            <li key={chip} className="rounded-full border border-border bg-card px-2.5 py-1">
              {chip}
            </li>
          ))}
        </ul>
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
