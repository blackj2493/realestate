/**
 * Browser Supabase client (cookie-based session via @supabase/ssr).
 *
 * Use from Client Components to read the signed-in user and call auth methods
 * (e.g. signInWithOtp for magic links). Sessions are stored in cookies so the
 * server (middleware + route handlers) can read them too. ANON key only.
 */

import { createBrowserClient } from '@supabase/ssr';

const SUPABASE_URL = (
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://pyzgnivilxhnwzfrdkiq.supabase.co'
).trim();
const SUPABASE_ANON_KEY = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim();

export function createClient() {
  return createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}
