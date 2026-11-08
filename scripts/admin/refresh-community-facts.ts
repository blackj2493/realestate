/**
 * Refresh community_market_facts (migration 163) — the per-neighbourhood market facts
 * the neighbourhood hub pages show (src/lib/data/communityFacts.ts).
 *
 * One RPC: refresh_community_market_facts() rebuilds the whole table in one transaction
 * (~6s on 2026-11-08, ~2,200 rows) and carries its own 180s statement_timeout. The
 * client abort is raised to match through SUPABASE_FETCH_TIMEOUT_MS in daily-sync.yml.
 *
 * Usage:
 *   npx tsx scripts/admin/refresh-community-facts.ts            # dry-run: row count only
 *   npx tsx scripts/admin/refresh-community-facts.ts --apply    # rebuild the table
 */
import "dotenv/config";
import { getServiceRoleClient } from "@/lib/supabase/client";

const APPLY = process.argv.includes("--apply");

async function main(): Promise<void> {
  const sb = getServiceRoleClient();
  if (!APPLY) {
    const { count, error } = await sb.from("community_market_facts").select("city", { count: "exact", head: true });
    if (error) throw new Error(error.message);
    console.log(`[community-facts] dry run: ${count ?? 0} rows now. Pass --apply to rebuild.`);
    return;
  }
  const t = Date.now();
  const { data, error } = await sb.rpc("refresh_community_market_facts");
  if (error) throw new Error(error.message);
  console.log(`[community-facts] rebuilt ${data} rows in ${Date.now() - t} ms`);
  // A rebuild that yields almost nothing means an upstream table went empty. Fail the
  // step loudly (it is continue-on-error) rather than serving no facts silently.
  if (typeof data === "number" && data < 500) throw new Error(`only ${data} rows — check raw_vow_sold / listings`);
}

main().catch((e) => {
  console.error("[community-facts] failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
