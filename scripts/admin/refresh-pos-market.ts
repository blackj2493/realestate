/**
 * Refresh the power-of-sale data (migration 164) for the /power-of-sale pages.
 *
 *   1. refresh_pos_sales(from, to): re-flag sales whose PublicRemarks say power of sale.
 *      Nightly: the last 45 days (late-reported closes land behind the watermark).
 *      --backfill-months=N: month by month, N months back (one-time; ~12s a month).
 *   2. refresh_pos_market_stats(): rebuild the per-region stats from flat columns.
 *   3. refresh_pos_monthly_stats(): per-region counts by calendar month (the monthly index, 166).
 *
 * Usage:
 *   npx tsx scripts/admin/refresh-pos-market.ts                       # dry run: row counts
 *   npx tsx scripts/admin/refresh-pos-market.ts --apply               # nightly
 *   npx tsx scripts/admin/refresh-pos-market.ts --apply --backfill-months=25
 */
import "dotenv/config";
import { getServiceRoleClient } from "@/lib/supabase/client";

const APPLY = process.argv.includes("--apply");
const BACKFILL = Number((process.argv.find((a) => a.startsWith("--backfill-months=")) ?? "").split("=")[1] || 0);
const NIGHTLY_DAYS = 45;

const iso = (d: Date) => d.toISOString().slice(0, 10);

function windows(): { from: string; to: string }[] {
  const tomorrow = new Date(Date.now() + 86_400_000);
  if (BACKFILL > 0) {
    const out: { from: string; to: string }[] = [];
    const end = new Date(Date.UTC(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth() + 1, 1));
    for (let i = BACKFILL; i >= 1; i--) {
      const from = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - i, 1));
      const to = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - i + 1, 1));
      out.push({ from: iso(from), to: iso(to) });
    }
    return out;
  }
  return [{ from: iso(new Date(Date.now() - NIGHTLY_DAYS * 86_400_000)), to: iso(tomorrow) }];
}

async function main(): Promise<void> {
  const sb = getServiceRoleClient();
  if (!APPLY) {
    const [{ count: flagged }, { count: stats }] = await Promise.all([
      sb.from("pos_sales").select("listing_key", { count: "exact", head: true }),
      sb.from("pos_market_stats").select("region", { count: "exact", head: true }),
    ]);
    console.log(`[pos] dry run: ${flagged ?? 0} flagged sales, ${stats ?? 0} stats rows. Windows: ${JSON.stringify(windows())}`);
    return;
  }
  let flagged = 0;
  for (const w of windows()) {
    const t = Date.now();
    const { data, error } = await sb.rpc("refresh_pos_sales", { p_from: w.from, p_to: w.to });
    if (error) throw new Error(`refresh_pos_sales ${w.from}..${w.to}: ${error.message}`);
    flagged += Number(data) || 0;
    console.log(`[pos] ${w.from}..${w.to}: ${data} power-of-sale sales (${Date.now() - t} ms)`);
  }
  const t = Date.now();
  const { data, error } = await sb.rpc("refresh_pos_market_stats");
  if (error) throw new Error(`refresh_pos_market_stats: ${error.message}`);
  console.log(`[pos] stats: ${data} rows (${Date.now() - t} ms); ${flagged} sales flagged this run`);
  if (typeof data === "number" && data < 20) throw new Error(`only ${data} stats rows — check raw_vow_sold`);

  // 3. Per-month counts for the monthly Power of Sale Index (migration 166).
  const tm = Date.now();
  const monthly = await sb.rpc("refresh_pos_monthly_stats");
  if (monthly.error) throw new Error(`refresh_pos_monthly_stats: ${monthly.error.message}`);
  console.log(`[pos] monthly: ${monthly.data} rows (${Date.now() - tm} ms)`);
  if (typeof monthly.data === "number" && monthly.data < 24) throw new Error(`only ${monthly.data} monthly rows — check raw_vow_sold`);
}

main().catch((e) => {
  console.error("[pos] failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
