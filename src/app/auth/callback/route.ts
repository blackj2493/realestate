/**
 * PKCE magic-link callback. The email link (default Supabase template) redirects
 * here with `?code=...`; we exchange it for a session cookie, then bounce the user
 * to `next` (default /dashboard). Used by signInWithOtp from the browser client.
 */

import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/dashboard';

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Open-redirect guard: only relative, single-slash paths (reject protocol-relative `//host`).
      const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard';
      return NextResponse.redirect(`${origin}${safeNext}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
