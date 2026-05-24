/**
 * Server Supabase client bound to the request cookies (@supabase/ssr).
 *
 * Use from Route Handlers / Server Components / Server Actions to read the
 * signed-in user and run queries under that user's identity (RLS enforced via
 * the ANON key + the user's JWT in the cookie). For privileged ETL access use
 * getServiceRoleClient() in ./client instead.
 *
 * Next.js 16: cookies() is async, so this returns a Promise.
 */

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

const SUPABASE_URL = (
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://pyzgnivilxhnwzfrdkiq.supabase.co'
).trim();
const SUPABASE_ANON_KEY = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim();

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // setAll was called from a Server Component (read-only cookies).
          // Safe to ignore — middleware refreshes the session cookie instead.
        }
      },
    },
  });
}

/** Convenience: the authenticated user for this request, or null. */
export async function getCurrentUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}
