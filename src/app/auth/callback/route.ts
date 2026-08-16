/**
 * PKCE magic-link callback. The email link (default Supabase template) redirects
 * here with `?code=...`; we exchange it for a session cookie, then bounce the user
 * through /welcome. Used by signInWithOtp from the browser client.
 *
 * A MISSING `next` is passed through as null on purpose — do NOT default it to
 * /dashboard. postSignInPath treats "no destination" as a signup rather than a
 * navigation, which is what lets /welcome offer the first-run market picker and open
 * the terminal. Defaulting here forged an explicit destination and silently disabled it.
 */

import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { postSignInPath } from '@/lib/auth/postSignInPath';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next');

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
