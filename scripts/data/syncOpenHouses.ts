/**
 * Sync public.open_houses (migration 177) from the PropTx OpenHouse resource: every open house
 * dated from yesterday on, with the listing's City from public.listings, so /open-houses/{city}
 * can filter by city.
 *
 *   npx tsx scripts/data/syncOpenHouses.ts           # fetch and print counts only
 *   npx tsx scripts/data/syncOpenHouses.ts --write   # also upsert and prune
 *
 * Run every 6 hours by sync-open-houses.yml. IDX token: open houses on active listings are public.
 *
 * PRUNE. A future open house that is no longer in the feed was cancelled or its listing ended:
 * the run deletes future rows it did not see. It never prunes after an empty or short fetch
 * (under half of the future rows stored before the run), so a feed outage keeps the
 * last good data instead of emptying the pages. Rows more than 7 days old are deleted.
 */
import "dotenv/config";
import { Client } from "pg";

const WRITE = process.argv.includes("--write");
const API = process.env.AMPRE_API_URL || "https://query.ampre.ca/odata";
const PAGE = 500;

interface FeedRow {
  OpenHouseKey: string;
  ListingKey: string;
  OpenHouseDate: string;
  OpenHouseStartTime?: string | null;
  OpenHouseEndTime?: string | null;
  OpenHouseType?: string | null;
  OpenHouseFormat?: string | string[] | null;
  OpenHouseStatus?: string | null;
  OpenHouseURL?: string | null;
  ModificationTimestamp?: string | null;
}

const torontoDate = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto" }).format(d);

async function fetchAll(token: string, from: string): Promise<FeedRow[]> {
  const rows: FeedRow[] = [];
  for (let skip = 0; ; skip += PAGE) {
    const q = `$filter=OpenHouseDate ge ${from}&$orderby=OpenHouseKey&$top=${PAGE}&$skip=${skip}`;
    const res = await fetch(`${API}/OpenHouse?${q.replace(/ /g, "%20")}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    if (!res.ok) throw new Error(`OpenHouse ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const page = ((await res.json()) as { value: FeedRow[] }).value ?? [];
    rows.push(...page);
    if (page.length < PAGE) return rows;
    if (skip > 100_000) throw new Error("OpenHouse paging did not end");
  }
}

async function main() {
  const token = process.env.PROPTX_IDX_TOKEN;
  const url = process.env.DATABASE_URL || process.env.DIRECT_DB_URL;
  if (!token) throw new Error("PROPTX_IDX_TOKEN is required.");
  if (!url) throw new Error("DATABASE_URL (Session pooler) is required.");

  const today = torontoDate(new Date());
  const from = torontoDate(new Date(Date.now() - 864e5));
  const feed = (await fetchAll(token, from)).filter((r) => r.OpenHouseKey && r.ListingKey && /^\d{4}-\d{2}-\d{2}$/.test(r.OpenHouseDate ?? ""));
  const byKey = new Map(feed.map((r) => [r.OpenHouseKey, r]));
  const rows = [...byKey.values()];
  console.log(`feed: ${rows.length} open houses from ${from} (${rows.filter((r) => r.OpenHouseDate >= today).length} from today)`);

  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const keys = [...new Set(rows.map((r) => r.ListingKey))];
    const cities = new Map<string, string>();
    const txType = new Map<string, string>();
    for (let i = 0; i < keys.length; i += 1000) {
      const res = await client.query<{ listing_key: string; city: string | null; tx: string | null }>(
        "select listing_key, city, full_payload->>'TransactionType' tx from public.listings where listing_key = any($1::text[])",
        [keys.slice(i, i + 1000)],
      );
      for (const r of res.rows) {
        if (r.city) cities.set(r.listing_key, r.city);
        if (r.tx) txType.set(r.listing_key, r.tx);
      }
    }
    console.log(`cities found for ${cities.size} of ${keys.length} listings`);
    if (!WRITE) return;

    const before = Number((await client.query("select count(*) n from public.open_houses where open_date >= $1", [today])).rows[0].n);
    // The database clock, not this machine's: synced_at is set by now() in the database, and a
    // local clock that runs ahead made every fresh row look unseen (2026-11-26 first run).
    const runStart: string = (await client.query("select now()::text t")).rows[0].t;
    for (let i = 0; i < rows.length; i += PAGE) {
      const b = rows.slice(i, i + PAGE);
      const fmt = (f: FeedRow["OpenHouseFormat"]) => (Array.isArray(f) ? f.join(", ") : f ?? null);
      await client.query(
        `insert into public.open_houses (open_house_key, listing_key, city, transaction_type, open_date, start_at, end_at, open_type, open_format, status, url, modified_at, synced_at)
         select * , now() from unnest($1::text[], $2::text[], $3::text[], $12::text[], $4::date[], $5::timestamptz[], $6::timestamptz[], $7::text[], $8::text[], $9::text[], $10::text[], $11::timestamptz[])
         on conflict (open_house_key) do update set listing_key = excluded.listing_key, city = excluded.city, transaction_type = excluded.transaction_type, open_date = excluded.open_date,
           start_at = excluded.start_at, end_at = excluded.end_at, open_type = excluded.open_type, open_format = excluded.open_format,
           status = excluded.status, url = excluded.url, modified_at = excluded.modified_at, synced_at = now()`,
        [
          b.map((r) => r.OpenHouseKey),
          b.map((r) => r.ListingKey),
          b.map((r) => cities.get(r.ListingKey) ?? null),
          b.map((r) => r.OpenHouseDate),
          b.map((r) => r.OpenHouseStartTime || null),
          b.map((r) => r.OpenHouseEndTime || null),
          b.map((r) => r.OpenHouseType ?? null),
          b.map((r) => fmt(r.OpenHouseFormat)),
          b.map((r) => r.OpenHouseStatus ?? null),
          b.map((r) => r.OpenHouseURL || null),
          b.map((r) => r.ModificationTimestamp || null),
          b.map((r) => txType.get(r.ListingKey) ?? null),
        ],
      );
    }
    const seen = rows.filter((r) => r.OpenHouseDate >= today).length;
    if (seen > 0 && seen >= before / 2) {
      const del = await client.query("delete from public.open_houses where open_date >= $1 and synced_at < $2", [today, runStart]);
      console.log(`pruned ${del.rowCount} future open houses no longer in the feed`);
    } else {
      console.log(`NOT pruning: saw ${seen} future rows against ${before} stored before the run`);
    }
    const old = await client.query("delete from public.open_houses where open_date < (current_date - 7)");
    console.log(`upserted ${rows.length}; deleted ${old.rowCount} older than 7 days`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
