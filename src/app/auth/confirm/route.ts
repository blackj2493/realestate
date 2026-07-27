/**
 * Token-hash magic-link confirmation (OTP verify). Used if the Supabase email
 * template is switched to the SSR-recommended form:
 *   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email
 * The default `?code=` template hits /auth/callback instead — both are supported.
 *
 * Leave `next` OUT of that email template. A missing `next` is passed through as null
 * on purpose — postSignInPath reads "no destination" as a signup rather than a
 * navigation, which is what lets /welcome offer the first-run market picker and open
 * the terminal. Pinning &next=/dashboard in the template silently disables it.
 */

import { type EmailOtpType } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { postSignInPath } from '@/lib/auth/postSignInPath';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  const next = searchParams.get('next');

  if (tokenHash && type) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      // Route through /welcome so first-time users accept the VOW Terms before landing
      // on `next` (idempotent — accepted users pass straight through). postSignInPath
      // also applies the open-redirect guard (relative, single-slash paths only).
      return NextResponse.redirect(`${origin}${postSignInPath(next)}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
