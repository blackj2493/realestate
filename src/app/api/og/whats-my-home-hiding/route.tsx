import { ImageResponse } from 'next/og';
import type { NextRequest } from 'next/server';
import { deslugifyCommunity } from '@/lib/reno/communitySlug';

export const runtime = 'edge';

export function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get('community');
  const community = slug ? deslugifyCommunity(slug) : null;
  const headline = community
    ? `Which renovation pays you back most in ${community}?`
    : 'What renovation pays you back most in your home?';

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: 'linear-gradient(135deg, #16202e 0%, #0a0e15 60%)',
          padding: '64px',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', color: '#7ee0b8', fontSize: 28, fontWeight: 700, letterSpacing: 1 }}>
          PUREPROPERTY.CA
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ color: '#ffffff', fontSize: 60, fontWeight: 800, lineHeight: 1.15 }}>
            {headline}
          </div>
          <div style={{ color: '#9fb0c2', fontSize: 30 }}>Most homeowners guess wrong.</div>
        </div>
        <div style={{ display: 'flex', color: '#0a0e15', background: '#2f7d5b', alignSelf: 'flex-start', padding: '14px 26px', borderRadius: 10, fontSize: 28, fontWeight: 700 }}>
          Find your home&#39;s #1 move →
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
