/**
 * Retention pruning for the VOW consumer-access audit trail (migration 053 / VOW §5.4).
 *
 * Deletes rows older than VOW_ACCESS_LOG_RETENTION_DAYS (default 365). A short window bounds
 * BOTH storage and the privacy surface — we retain only as much history as the §5.4
 * "producible on demand" purpose needs. Idempotent; safe to run repeatedly (most runs delete
 * nothing). Runs as a continue-on-error step in the daily sync, so a failure never affects it.
 *
 * Invoke: npx tsx scripts/worker/pruneVowAccessLog.ts
 * Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *      (optional) VOW_ACCESS_LOG_RETENTION_DAYS
 */

import 'dotenv/config';
import { getServiceRoleClient } from '@/lib/supabase/client';

const RETENTION_DAYS = Number(process.env.VOW_ACCESS_LOG_RETENTION_DAYS) || 365;

async function main(): Promise<void> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { error, count } = await getServiceRoleClient()
    .from('vow_access_log')
    .delete({ count: 'exact' })
    .lt('accessed_at', cutoff);
  if (error) {
    console.error('[pruneVowAccessLog] failed:', error.message);
    process.exit(1);
  }
  console.log(`✅ Pruned ${count ?? 0} vow_access_log rows older than ${RETENTION_DAYS}d (before ${cutoff}).`);
}

main().catch((e) => {
  console.error('[pruneVowAccessLog] threw:', e instanceof Error ? e.message : e);
  process.exit(1);
});
