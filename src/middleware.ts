import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';
import { extractListingKey } from '@/lib/listings/listingPath';
import { decideHost, parseAllowedHosts } from '@/lib/security/allowedHosts';

// NOTE: this file MUST live at src/middleware.ts (NOT the project root). The app is
// under src/, so Next.js only picks up middleware from src/ — a root middleware.ts is
// silently ignored (which is why session-refresh + the rewrite below never ran before).

export async function middleware(request: NextRequest) {
  // ── Registered-host gate (compliance audit R7) ────────────────────────────────
  // IDX §6.3(g) requires every URL displaying board data to be pre-registered. Without
  // this, every Vercel preview deployment serves the whole product — real IDX/VOW data —
  // on a host PROPTX has never seen. Runs FIRST and covers /api too (see matcher): the
  // data routes are the ones that actually hand out listings.
  // No-op until ALLOWED_HOSTS is set.
  const decision = decideHost(
    request.headers.get('host') ?? request.nextUrl.host,
    parseAllowedHosts(process.env.ALLOWED_HOSTS)
  );
  if (!decision.allowed) {
    // 404, not 403: an unregistered host should not learn that anything is here.
    return new NextResponse(null, { status: 404 });
  }

  // API routes get the host gate and nothing else — they read cookies directly and must
  // not go through updateSession or the listing-URL rewrites below.
  if (request.nextUrl.pathname.startsWith('/api')) return NextResponse.next();

  // Phase 1c — descriptive listing URLs. /property/{prov}/{city}/{address}-{KEY}
  // rewrites INTERNALLY to the existing /properties/{KEY} route: the URL bar stays
  // descriptive (and the page sets its canonical to this descriptive path), while the
  // render is the unchanged listing page. No redirect, so no loop and no big refactor.
  // (extractListingKey is pure/Edge-safe — it pulls the KEY off the slug tail.)
  // Friendly redirect: the plural namespace /properties/{prov}/{city}[/{slug}] (easy to
  // mistype) → the singular /property hub + listing URLs. Single-segment /properties/{id}
  // and /properties/compare are real app routes and are NOT matched here.
  const plural = /^\/properties\/([^/]+\/[^/]+(?:\/[^/]+)?)\/?$/.exec(request.nextUrl.pathname);
  if (plural) {
    const url = request.nextUrl.clone();
    url.pathname = `/property/${plural[1]}`;
    return NextResponse.redirect(url, 308);
  }

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
     * Match all routes EXCEPT build assets and static images.
     *
     * `api` used to be excluded here. It no longer is: the host gate has to cover the
     * data routes, which are precisely the ones that hand out listing information — a
     * gate on pages alone would leave `/api/...` answering on any host. The handler
     * early-returns for /api immediately after the gate, so those routes still skip
     * updateSession and the listing-URL rewrites exactly as before.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
