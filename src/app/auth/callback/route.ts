/**
 * PKCE magic-link callback. The email link (default Supabase template) redirects
 * here with `?code=...`; we exchange it for a session cookie, then bounce the user
 * to `next` (default /dashboard). Used by signInWithOtp from the browser client.
 */

import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { postSignInPath } from '@/lib/auth/postSignInPath';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/dashboard';

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Route through /welcome so first-time users accept the VOW Terms before landing
      // on `next` (idempotent — accepted users pass straight through). postSignInPath
      // also applies the open-redirect guard (relative, single-slash paths only).
      return NextResponse.redirect(`${origin}${postSignInPath(next)}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
