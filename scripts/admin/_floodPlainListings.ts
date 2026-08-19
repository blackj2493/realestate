/**
 * (probe) Which live listings say "floodplain" in The Read?
 *
 * The flood flag is a geo-joined public-records fact: enrichGeoFlags.ts intersects each
 * listing's block-level point with the TRCA Regulated Floodplain polygons (geo_features,
 * kind='flood') and writes a DiligenceFlag { id:'flood', kind:'warn', severity:70,
 * title:'Within a regulated floodplain' } into listing_geo_flags.flags (migration 037).
 *
 * On the listing page that flag reaches the reader twice:
 *   1. Things to Know — every warn flag is listed, always.
 *   2. The Read's catch line — buildTheRead() folds warn flags into the catch ledger and
 *      keeps only the TOP 3 by severity (theRead.ts:264-278). At severity 70 the flood
 *      flag outranks nearly every payload-derived negative, so it normally survives the
 *      cut — but a listing carrying several higher-severity warns can push it out.
 * This probe reports both: whether the flag exists, and whether it wins a top-3 slot
 * against the other *flags* (the only competitors this script can see without building
 * the full ListingDetail — price/DOM/fee negatives are computed on the page).
 *
 * READ-ONLY. No writes. Deterministic SQL, no LLM (CLAUDE.md §4).
 *
 * Requires DATABASE_URL = Supabase **Session pooler** string, port 5432 (CLAUDE.md §12).
 *
 *   npx tsx scripts/admin/_floodPlainListings.ts
 *   npx tsx scripts/admin/_floodPlainListings.ts --limit 10 --city Toronto
 *   npx tsx scripts/admin/_floodPlainListings.ts --any-status   (include sold/expired)
 *   npx tsx scripts/admin/_floodPlainListings.ts --remarks      (agent-disclosed instead)
 */

import { Client } from "pg";
import dotenv from "dotenv";

dotenv.config({ path: [".env.local", ".env"] });

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const LIMIT = Number(argValue("limit") ?? 5);
const CITY = argValue("city");
const ANY_STATUS = process.argv.includes("--any-status");
// Cross-check mode: instead of our geo flag, find listings whose AGENT wrote the flood
// plain into PublicRemarks. Useful to see where the TRCA join and the listing agent's own
// disclosure disagree — remarks are IDX/VOW text, matched by deterministic SQL only (§4).
const REMARKS = process.argv.includes("--remarks");
const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pureproperty.ca";

// Same "is it still on market" predicate the other admin scripts use — the feed spreads
// status across three keys and only agrees on the non-active vocabulary (backfill020.ts).
const NON_ACTIVE = "('sold', 'closed', 'closed sale', 'leased', 'terminated', 'expired', 'suspended')";
const STATUS_EXPR =
  "lower(coalesce(l.full_payload->>'Status', l.full_payload->>'MlsStatus', l.full_payload->>'StandardStatus', ''))";

interface Flag {
  id: string;
  kind: "warn" | "info";
  severity: number;
  title: string;
  source: string;
  asOf?: string;
}

interface Row {
  listing_key: string;
  address: string | null;
  city: string | null;
  list_price: string | number | null;
  status: string | null;
  remarks: string | null;
  flags: Flag[] | null;
}

const money = (v: string | number | null) =>
  v == null ? "—" : `$${Number(v).toLocaleString("en-CA")}`;

async function main() {
  const DATABASE_URL = process.env.DATABASE_URL || process.env.DIRECT_DB_URL;
  if (!DATABASE_URL) {
    console.error(
      "❌ Missing DATABASE_URL. Use the Supabase **Session pooler** string (port 5432) —\n" +
        "   DIRECT_DB_URL is IPv6-only and will not resolve here (CLAUDE.md §12)."
    );
    process.exit(1);
  }

  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  console.log(
    REMARKS
      ? `\n🌊 Listings whose PublicRemarks mention a flood plain / flood zone`
      : `\n🌊 Listings whose flags carry the TRCA floodplain warn (→ The Read)`
  );
  console.log("==================================================================\n");

  const params: unknown[] = [];
  const where: string[] = [
    REMARKS
      ? `l.full_payload->>'PublicRemarks' ~* '(flood\\s*plain|floodplain|flood\\s*zone|flood\\s*line)'`
      : `g.flags @> '[{"id":"flood"}]'::jsonb`,
  ];
  if (!ANY_STATUS) where.push(`${STATUS_EXPR} NOT IN ${NON_ACTIVE}`);
  if (CITY) {
    params.push(CITY);
    where.push(`l.city ILIKE $${params.length}`);
  }
  params.push(LIMIT);

  const { rows } = await client.query<Row>(
    `SELECT l.listing_key,
            l.full_payload->>'UnparsedAddress' AS address,
            left(l.full_payload->>'PublicRemarks', 400) AS remarks,
            l.city,
            l.list_price,
            coalesce(l.full_payload->>'Status', l.full_payload->>'MlsStatus',
                     l.full_payload->>'StandardStatus') AS status,
            g.flags
       FROM listings l
       LEFT JOIN listing_geo_flags g ON g.listing_key = l.listing_key
      WHERE ${where.join("\n        AND ")}
      ORDER BY l.list_price DESC NULLS LAST
      LIMIT $${params.length}`,
    params
  );

  if (!rows.length) {
    console.log(
      REMARKS
        ? "   (none) — no listing under these filters writes a flood plain into its remarks.\n"
        : "   (none) — either no listing intersects the TRCA floodplain under the current\n" +
          "   filters, or enrichGeoFlags.ts has not been run since the last sync:\n" +
          "     npx tsx scripts/worker/enrichGeoFlags.ts --dataset flood\n"
    );
  }

  for (const r of rows) {
    const flags = (r.flags ?? []).filter((f) => f && typeof f.severity === "number");
    const warns = flags.filter((f) => f.kind === "warn").sort((a, b) => b.severity - a.severity);
    const flood = warns.find((f) => f.id === "flood");
    const rank = warns.findIndex((f) => f.id === "flood") + 1;
    const inCatch = rank > 0 && rank <= 3;

    console.log(`▸ ${r.address ?? "(no address)"} — ${r.city ?? "?"} · ${money(r.list_price)} · ${r.status ?? "?"}`);
    console.log(`  ${SITE}/properties/${r.listing_key}`);
    if (REMARKS && r.remarks) {
      const hit = /(flood\s*plain|floodplain|flood\s*zone|flood\s*line)/i.exec(r.remarks);
      const at = hit ? Math.max(0, hit.index - 90) : 0;
      console.log(`  remark: …${r.remarks.slice(at, at + 220).replace(/\s+/g, " ")}…`);
    }
    if (flood) {
      console.log(`  flag:   ${flood.title} (sev ${flood.severity}${flood.asOf ? `, as of ${flood.asOf}` : ""})`);
      console.log(`  source: ${flood.source}`);
    }
    if (!flood) {
      console.log(`  in The Read's catch: NO TRCA flag on this one — agent-disclosed only`);
    } else {
      console.log(
        `  in The Read's catch: ${inCatch ? "YES" : "probably not"} — ranks #${rank} of ${warns.length} warn flag(s)` +
          (inCatch ? "" : "; higher-severity warns crowd it out of the top 3")
      );
    }
    const others = warns.filter((f) => f.id !== "flood");
    if (others.length) {
      console.log(`  other warns: ${others.map((f) => `${f.title} (${f.severity})`).join(" · ")}`);
    }
    console.log("");
  }

  const { rows: totals } = await client.query<{ n: string; active: string }>(
    `SELECT count(*)::text AS n,
            count(*) FILTER (WHERE ${STATUS_EXPR} NOT IN ${NON_ACTIVE})::text AS active
       FROM listings l
       LEFT JOIN listing_geo_flags g ON g.listing_key = l.listing_key
      WHERE ${where[0]}`
  );
  console.log(
    `📊 ${REMARKS ? "remark-disclosed" : "flood-flagged"} listings: ` +
      `${totals[0]?.n ?? 0} total · ${totals[0]?.active ?? 0} still on market\n`
  );

  await client.end();
  console.log("🔌 Connection closed.\n");
}

main().catch((err) => {
  console.error("❌", err);
  process.exit(1);
});
