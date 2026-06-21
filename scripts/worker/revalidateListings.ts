import "dotenv/config";
import { getServiceRoleClient } from "@/lib/supabase/client";

/**
 * Post-sync cache refresh: tell the deployed Next app to purge the cached detail for
 * every listing synced in the last N hours, so nightly changes appear immediately
 * instead of within the page's 1h TTL.
 *
 * This is ADDITIVE POLISH, not load-bearing:
 *   • It runs as a `continue-on-error` step (see daily-sync.yml) and never touches the
 *     core ingester — a failure here cannot break the sync.
 *   • If NEXT_PUBLIC_SITE_URL or REVALIDATE_SECRET is unset, it no-ops cleanly; the 1h
 *     cache TTL still keeps displayed data inside the IDX §6.3(h) refresh rule.
 *
 * Run: npx tsx scripts/worker/revalidateListings.ts
 */
const SINCE_HOURS = Number(process.env.REVALIDATE_SINCE_HOURS || 25); // ~daily cadence + margin
const CONCURRENCY = 5; // gentle on the app; the delta is incremental, not the full book

async function main(): Promise<void> {
  const base = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  const secret = process.env.REVALIDATE_SECRET;
  if (!base || !secret) {
    console.log(
      "[revalidate] NEXT_PUBLIC_SITE_URL or REVALIDATE_SECRET unset — skipping (1h TTL still refreshes).",
    );
    return;
  }

  const since = new Date(Date.now() - SINCE_HOURS * 3_600_000).toISOString();
  const supabase = getServiceRoleClient();

  // Page the changed-listing keys (PostgREST caps a response at 1000 rows).
  const keys: string[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("listings")
      .select("listing_key")
      .gte("synced_at", since)
      .order("listing_key")
      .range(from, from + 999);
    if (error) {
      console.error("[revalidate] listings query failed:", error.message);
      break;
    }
    if (!data || data.length === 0) break;
    keys.push(...data.map((r) => r.listing_key as string).filter(Boolean));
    if (data.length < 1000) break;
  }
  console.log(`[revalidate] ${keys.length} listings synced since ${since}`);

  let ok = 0;
  let fail = 0;
  for (let i = 0; i < keys.length; i += CONCURRENCY) {
    const batch = keys.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (listingKey) => {
        try {
          const res = await fetch(`${base}/api/revalidate`, {
            method: "POST",
            headers: { "content-type": "application/json", "x-revalidate-secret": secret },
            body: JSON.stringify({ listingKey }),
          });
          if (res.ok) ok++;
          else fail++;
        } catch {
          fail++;
        }
      }),
    );
  }
  console.log(`[revalidate] done — ${ok} ok, ${fail} failed`);
}

main().catch((e) => {
  // Best-effort: log and exit 0 so this can never fail the nightly workflow.
  console.error("[revalidate] fatal (ignored):", e);
});
