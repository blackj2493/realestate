/**
 * Grant founding seats to the accounts that already exist.
 *
 * The counter on /whats-my-home-hiding reads a true COUNT(*) of founding_seats, so
 * on an empty table it opens at 0/200 — which reads as "nobody wants this" to the
 * first person we send the link to. The honest fix is not a display offset: our
 * earliest signups genuinely ARE the founding members, so this hands them their
 * seats, oldest signup first, and seat #1 really is the first person who registered.
 *
 * Every seat written here belongs to a real auth user with a real email. Nothing
 * inflates the number — delete a row and the counter drops by one, because the
 * count IS the people.
 *
 * Idempotent: user_id is UNIQUE and existing holders are skipped, so re-running
 * never double-grants or burns seat numbers.
 *
 * Usage:
 *   npx tsx scripts/admin/seedFoundingSeats.ts                  # dry-run (prints, no write)
 *   npx tsx scripts/admin/seedFoundingSeats.ts --apply          # grant seats
 *   npx tsx scripts/admin/seedFoundingSeats.ts --apply --limit=127
 */

// TLS env before importing the supabase client (mirrors the other admin jobs).
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const FOUNDING_SEAT_TOTAL = 200;

const APPLY = process.argv.includes('--apply');
const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const LIMIT = limitArg ? Number(limitArg.split('=')[1]) : FOUNDING_SEAT_TOTAL;

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }
  if (!Number.isFinite(LIMIT) || LIMIT < 1) {
    console.error(`--limit must be a positive number (got ${LIMIT})`);
    process.exit(1);
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const { count: already, error: countErr } = await supabase
    .from('founding_seats')
    .select('seat', { count: 'exact', head: true });
  if (countErr) {
    console.error('Could not read founding_seats — is migration 110 applied?', countErr.message);
    process.exit(1);
  }

  const room = Math.min(LIMIT, FOUNDING_SEAT_TOTAL) - (already ?? 0);
  if (room <= 0) {
    console.log(`Nothing to do — ${already} seats already granted (target ${LIMIT}).`);
    return;
  }

  // Oldest signups first: seat order mirrors the order people actually arrived.
  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('id, email, created_at')
    .order('created_at', { ascending: true })
    .limit(FOUNDING_SEAT_TOTAL * 2);
  if (error) {
    console.error('Could not read profiles:', error.message);
    process.exit(1);
  }

  const { data: held } = await supabase.from('founding_seats').select('user_id');
  const taken = new Set((held ?? []).map((r) => r.user_id as string));

  const candidates = (profiles ?? []).filter((p) => !taken.has(p.id)).slice(0, room);

  console.log(`seats already granted : ${already}`);
  console.log(`eligible profiles     : ${candidates.length}`);
  console.log(`target total          : ${Math.min(LIMIT, FOUNDING_SEAT_TOTAL)} of ${FOUNDING_SEAT_TOTAL}`);
  if (candidates.length) {
    const a = candidates[0];
    const z = candidates[candidates.length - 1];
    console.log(`oldest                : ${a.email} (${a.created_at})`);
    console.log(`newest                : ${z.email} (${z.created_at})`);
  }

  if (!APPLY) {
    console.log('\nDRY RUN — nothing written. Re-run with --apply to grant these seats.');
    return;
  }

  // Sequential, in created_at order, so the BIGSERIAL hands out seat numbers in the
  // same order people signed up. A couple of seconds, once.
  let granted = 0;
  for (const p of candidates) {
    const { error: insErr } = await supabase
      .from('founding_seats')
      .insert({ user_id: p.id, email: p.email, source: 'seed:existing-users' });
    if (insErr) {
      // A duplicate just means a concurrent grant won the race; anything else is real.
      if (!insErr.message.toLowerCase().includes('duplicate')) {
        console.error(`  ! ${p.email}: ${insErr.message}`);
      }
      continue;
    }
    granted += 1;
  }

  const { count: final } = await supabase
    .from('founding_seats')
    .select('seat', { count: 'exact', head: true });

  console.log(`\ngranted ${granted} seats. Counter now reads ${final}/${FOUNDING_SEAT_TOTAL}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
