/**
 * Token-hash magic-link confirmation (OTP verify). Used if the Supabase email
 * template is switched to the SSR-recommended form:
 *   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/dashboard
 * The default `?code=` template hits /auth/callback instead — both are supported.
 */

import { type EmailOtpType } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { postSignInPath } from '@/lib/auth/postSignInPath';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  const next = searchParams.get('next') ?? '/dashboard';

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
