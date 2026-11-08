import "dotenv/config";
import { getServiceRoleClient } from "@/lib/supabase/client";
import { buildBodies, INDEXNOW_ENDPOINT, listingPath, nightlyPaths } from "@/lib/seo/indexNow";

/**
 * Nightly IndexNow ping: name every listing page that changed in the last 25 hours, plus
 * the city hubs and /data trackers (their numbers change every night), to Bing and the
 * other IndexNow engines. See src/lib/seo/indexNow.ts for the why.
 *
 * ALL statuses on purpose. A listing that sold or was withdrawn tonight changed too: its
 * page now says so (and drops out of the index). Telling Bing lets ChatGPT stop quoting a
 * home as "for sale". Measured 2026-11-06: ~7,200 changed rows a night, one POST.
 *
 * ADDITIVE, like revalidateListings.ts: a continue-on-error step in daily-sync.yml.
 * A failure here never affects the sync; a missed night is caught by the next one only
 * for the hubs, so the run log names the status of every POST.
 *
 * Run: npx tsx scripts/worker/indexNow.ts [--dry-run]
 */
const SINCE_HOURS = Number(process.env.INDEXNOW_SINCE_HOURS || 25);
const DRY = process.argv.includes("--dry-run");

async function changedListingPaths(): Promise<string[]> {
  const since = new Date(Date.now() - SINCE_HOURS * 3_600_000).toISOString();
  const supabase = getServiceRoleClient();
  const paths: string[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("listings")
      .select("listing_key, sitemap_path")
      .gte("synced_at", since)
      .order("listing_key")
      .range(from, from + 999);
    // An error is NOT exhaustion: say so, and send what we have (the hubs at least).
    if (error) {
      console.error(`[indexnow] listings query failed after ${paths.length} rows: ${error.message}`);
      break;
    }
    if (!data || data.length === 0) break;
    for (const r of data) {
      const p = listingPath(r as { listing_key: string | null; sitemap_path: string | null });
      if (p) paths.push(p);
    }
    if (data.length < 1000) break;
  }
  console.log(`[indexnow] ${paths.length} listing pages changed since ${since}`);
  return paths;
}

async function main(): Promise<void> {
  const site = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");
  const bodies = buildBodies(site, [...nightlyPaths(), ...(await changedListingPaths())]);
  const total = bodies.reduce((n, b) => n + b.urlList.length, 0);
  console.log(`[indexnow] ${total} URLs in ${bodies.length} POST(s) for ${bodies[0]?.host ?? "-"}`);
  if (DRY) {
    console.log(bodies.flatMap((b) => b.urlList).slice(0, 30).join("\n"));
    return;
  }
  for (const body of bodies) {
    const res = await fetch(INDEXNOW_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
    });
    // 200 = received; 202 = received, key check pending. 403 = key file not reachable;
    // 422 = a URL not on the host; 429 = too many requests.
    const text = res.ok ? "" : ` ${(await res.text()).slice(0, 300)}`;
    console.log(`[indexnow] POST ${body.urlList.length} URLs -> ${res.status}${text}`);
  }
}

main().catch((e) => {
  console.error("[indexnow] failed:", e);
  process.exit(1);
});
