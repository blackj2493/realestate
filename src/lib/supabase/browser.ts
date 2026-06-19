/**
 * Browser Supabase client (cookie-based session via @supabase/ssr).
 *
 * Use from Client Components to read the signed-in user and call auth methods
 * (signInWithOtp for email codes, signInWithOAuth for Google, and the passkey
 * methods). Sessions are stored in cookies so the server (middleware + route
 * handlers) can read them too. ANON key only.
 *
 * Passkeys: `experimental.passkey` opts into auth-js WebAuthn support
 * (auth.signInWithPasskey / auth.registerPasskey / auth.passkey.*). Requires
 * @supabase/supabase-js >= 2.105 and a configured Relying Party in the Supabase
 * dashboard (Authentication → Passkeys). The flag is forwarded verbatim to the
 * underlying createClient by @supabase/ssr. API is beta and may change.
 */

import { createBrowserClient } from '@supabase/ssr';

const SUPABASE_URL = (
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://pyzgnivilxhnwzfrdkiq.supabase.co'
).trim();
const SUPABASE_ANON_KEY = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim();

export function createClient() {
  return createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { experimental: { passkey: true } },
  });
}
