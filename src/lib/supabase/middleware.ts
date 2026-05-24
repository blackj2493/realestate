/**
 * Session-refresh helper for Next.js middleware (@supabase/ssr).
 *
 * Runs on page navigations to keep the signed-in user's access/refresh tokens
 * fresh in cookies. For anonymous visitors (no auth cookie) getUser() returns
 * without a network call, so this is effectively a no-op — the app stays
 * anonymous-first. API data routes are excluded via the matcher in middleware.ts.
 */

import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const SUPABASE_URL = (
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://pyzgnivilxhnwzfrdkiq.supabase.co'
).trim();
const SUPABASE_ANON_KEY = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim();

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  // Do not run code between createServerClient and getUser() — it refreshes
  // the token and is what keeps the cookie alive across navigations.
  await supabase.auth.getUser();

  return response;
}
