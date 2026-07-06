/**
 * VOW consumer-access audit trail (PROPTX VOW Datafeed Agreement §5.4).
 *
 * Records, minimally, that a registered Consumer accessed a piece of VOW Listing
 * Information: { user_id, resource, accessed_at }. Deliberately tiny — no VOW numbers, no
 * page content, no IP — just enough to produce a "who accessed what, when" trail to PROPTX
 * on demand without enlarging the privacy surface more than necessary.
 *
 * Call it ONLY once a caller has confirmed the accessor is a Consumer (getConsumer().isConsumer)
 * and only for real VOW resources (not demo fixtures). It awaits the insert but SWALLOWS any
 * error, so a logging failure can never break the request that already served the (authorized)
 * consumer. See migration 053_vow_access_log.sql and scripts/worker/pruneVowAccessLog.ts.
 */

import { getServiceRoleClient } from "@/lib/supabase/client";

export async function logVowAccess(userId: string, resource: string): Promise<void> {
  try {
    await getServiceRoleClient().from("vow_access_log").insert({ user_id: userId, resource });
  } catch (e) {
    // Never throw into the caller's request path — the access was already authorized.
    console.error("[vowAccessLog] insert failed (non-fatal):", e instanceof Error ? e.message : e);
  }
}
