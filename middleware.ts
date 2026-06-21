import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';
import { extractListingKey } from '@/lib/listings/listingPath';

export async function middleware(request: NextRequest) {
  // Phase 1c — descriptive listing URLs. /property/{prov}/{city}/{address}-{KEY}
  // rewrites INTERNALLY to the existing /properties/{KEY} route: the URL bar stays
  // descriptive (and the page sets its canonical to this descriptive path), while the
  // render is the unchanged listing page. No redirect, so no loop and no big refactor.
  // (extractListingKey is pure/Edge-safe — it pulls the KEY off the slug tail.)
  const m = /^\/property\/[^/]+\/[^/]+\/([^/]+)\/?$/.exec(request.nextUrl.pathname);
  if (m) {
    const key = extractListingKey(m[1]);
    if (key) {
      const url = request.nextUrl.clone();
      url.pathname = `/properties/${key}`;
      return NextResponse.rewrite(url);
    }
    // Descriptive path with no parseable KEY → fall through and let it 404 normally.
  }

  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all page routes EXCEPT:
     * - api          (hot data routes; they read cookies directly when needed)
     * - _next/static, _next/image (build assets)
     * - favicon and common image files
     */
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
