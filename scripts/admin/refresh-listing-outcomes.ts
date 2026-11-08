/**
 * Refresh listing_outcome_stats (migration 165) for the /house-not-selling pages:
 * per region, homes that sold vs homes that came off the market unsold (last 12 months),
 * with price cuts, days on market, and asking price vs similar homes. ~8s, flat columns.
 *
 * Usage:
 *   npx tsx scripts/admin/refresh-listing-outcomes.ts           # dry run: row count
 *   npx tsx scripts/admin/refresh-listing-outcomes.ts --apply   # nightly
 */
import "dotenv/config";
import { getServiceRoleClient } from "@/lib/supabase/client";

const APPLY = process.argv.includes("--apply");

async function main(): Promise<void> {
  const sb = getServiceRoleClient();
  if (!APPLY) {
    const { count } = await sb.from("listing_outcome_stats").select("region", { count: "exact", head: true });
    console.log(`[outcomes] dry run: ${count ?? 0} rows now. Pass --apply to rebuild.`);
    return;
  }
  const t = Date.now();
  const { data, error } = await sb.rpc("refresh_listing_outcome_stats");
  if (error) throw new Error(`refresh_listing_outcome_stats: ${error.message}`);
  console.log(`[outcomes] ${data} rows (${Date.now() - t} ms)`);
  if (typeof data === "number" && data < 30) throw new Error(`only ${data} rows — check raw_vow_sold / raw_vow_delisted`);
}

main().catch((e) => {
  console.error("[outcomes] failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
