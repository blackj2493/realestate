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
    ? `Every renovation ranked by what it returns per dollar spent, modelled on closed ${where} sales — not national reno averages. Free.`
    : 'Every renovation ranked by what it returns per dollar spent — modelled on closed sales of comparable homes in your neighbourhood, refreshed daily. Free.';
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
        <h1 className="mb-1.5 text-3xl font-bold text-foreground">What could a reno add to your home?</h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          Every renovation ranked by what it actually returns —{' '}
          <b className="font-semibold text-foreground">value added per dollar spent</b>, measured
          against closed sales of comparable homes in your neighbourhood. Not national reno averages,
          not a contractor&rsquo;s estimate.
        </p>
        {/* The credibility byline: three facts about the method, stated as facts. */}
        <ul className="mb-8 mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 font-mono text-[11.5px] text-muted-foreground">
          {[
            'Closed sales only — never asking prices',
            'Fitted per neighbourhood + property type',
            'Refreshed every 24h',
            'Free · about a minute',
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
