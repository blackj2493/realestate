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
  // Diagnostics: the original counters-only log hid a 100% failure rate for three
  // weeks (June 26 → July 18: every request 401'd on a GHA↔Vercel
  // REVALIDATE_SECRET mismatch, and "0 ok, N failed" carried no why). Tally
  // failures by HTTP status and keep one sample body so the cause is readable
  // straight from the run log.
  const failByStatus: Record<string, number> = {};
  let sampleFailure = "";
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
          if (res.ok) {
            ok++;
          } else {
            fail++;
            const status = String(res.status);
            failByStatus[status] = (failByStatus[status] ?? 0) + 1;
            if (!sampleFailure) {
              sampleFailure = `HTTP ${res.status}: ${(await res.text()).replace(/\s+/g, " ").slice(0, 200)}`;
            }
          }
        } catch (e) {
          fail++;
          failByStatus.network = (failByStatus.network ?? 0) + 1;
          if (!sampleFailure) {
            sampleFailure = `network: ${e instanceof Error ? e.message : String(e)}`;
          }
        }
      }),
    );
    // Zero successes across the first ~20 requests means a systemic cause (bad
    // secret, wrong URL, endpoint down) — every later request will fail the same
    // way, so stop hammering the app with thousands of doomed requests.
    if (ok === 0 && fail >= CONCURRENCY * 4) {
      console.error(`[revalidate] aborting early — first ${fail} requests ALL failed (systemic).`);
      break;
    }
  }
  console.log(`[revalidate] done — ${ok} ok, ${fail} failed`);
  if (fail > 0) {
    console.error(`[revalidate] failures by status: ${JSON.stringify(failByStatus)}`);
    console.error(`[revalidate] sample failure: ${sampleFailure}`);
    if (ok === 0) {
      console.error(
        "[revalidate] EVERY request failed — check that the GHA REVALIDATE_SECRET matches the Vercel Production env var and that NEXT_PUBLIC_SITE_URL points at the deployed host.",
      );
    }
  }
}

main().catch((e) => {
  // Best-effort: log and exit 0 so this can never fail the nightly workflow.
  console.error("[revalidate] fatal (ignored):", e);
});
