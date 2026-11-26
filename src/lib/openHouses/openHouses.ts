/**
 * Open houses for /open-houses and /open-houses/{city}: public, in-person or virtual open houses
 * on active For Sale listings in the next 7 days. Times and cities come from public.open_houses
 * (migration 177, synced every 6 hours by scripts/data/syncOpenHouses.ts); the cards come from
 * Typesense, so a listing that has sold or ended since the sync drops out by itself.
 */
import { cache } from "react";
import { getServiceRoleClient } from "@/lib/supabase/client";
import { searchListings, type ListingDocument } from "@/lib/typesense/client";

export { openHousesPath } from "@/lib/openHouses/paths";

/** Days ahead the pages cover, today included. */
export const WINDOW_DAYS = 7;
/** Typesense returns at most 100 documents per query. */
const MAX_LISTINGS = 100;

export interface OpenHouseSlot {
  date: string;
  startAt: string | null;
  endAt: string | null;
  virtual: boolean;
  url: string | null;
}

export interface OpenHouseListing {
  doc: ListingDocument;
  slots: OpenHouseSlot[];
}

const torontoDate = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto" }).format(d);

export function openHouseWindow(now: Date = new Date()): { from: string; to: string } {
  return { from: torontoDate(now), to: torontoDate(new Date(now.getTime() + (WINDOW_DAYS - 1) * 864e5)) };
}

interface Row {
  listing_key: string;
  city: string | null;
  open_date: string;
  start_at: string | null;
  end_at: string | null;
  open_format: string | null;
  url: string | null;
}

/** PostgREST returns at most 1,000 rows per request and says nothing, so read in pages. */
const READ_PAGE = 1000;

/** Public, not cancelled open houses in the window for these feed cities (all cities when null). */
async function rowsFor(cities: string[] | null): Promise<Row[]> {
  const { from, to } = openHouseWindow();
  const out: Row[] = [];
  for (let start = 0; start < 20 * READ_PAGE; start += READ_PAGE) {
    let q = getServiceRoleClient()
      .from("open_houses")
      .select("listing_key, city, open_date, start_at, end_at, open_format, url")
      .gte("open_date", from)
      .lte("open_date", to)
      .eq("open_type", "Public")
      .eq("transaction_type", "For Sale")
      // A null status is kept: NOT ILIKE on null would drop the row.
      .or("status.is.null,status.not.ilike.cancel*")
      .order("start_at", { ascending: true })
      .order("open_house_key", { ascending: true })
      .range(start, start + READ_PAGE - 1);
    if (cities) q = q.in("city", cities);
    const { data, error } = await q;
    if (error) {
      console.error("[open-houses] read failed:", error.message);
      return out;
    }
    out.push(...((data ?? []) as Row[]));
    if (!data || data.length < READ_PAGE) break;
  }
  return out;
}

const slotOf = (r: Row): OpenHouseSlot => ({
  date: r.open_date,
  startAt: r.start_at,
  endAt: r.end_at,
  virtual: /virtual/i.test(r.open_format ?? ""),
  url: r.url,
});

/** The next open houses for the feed cities of one hub, soonest first, as listing cards. */
export const getCityOpenHouses = cache(async (cities: string[]): Promise<{ listings: OpenHouseListing[]; total: number }> => {
  if (cities.length === 0) return { listings: [], total: 0 };
  const rows = await rowsFor(cities);
  const slots = new Map<string, OpenHouseSlot[]>();
  for (const r of rows) slots.set(r.listing_key, [...(slots.get(r.listing_key) ?? []), slotOf(r)]);
  const keys = [...slots.keys()].slice(0, MAX_LISTINGS);
  if (keys.length === 0) return { listings: [], total: 0 };
  try {
    const res = await searchListings({
      query: "*",
      rawFilterBy: `id:[${keys.join(",")}] && TransactionType:=\`For Sale\``,
      perPage: keys.length,
    });
    const docs = new Map(res.listings.map((d) => [d.id, d]));
    const listings = keys.filter((k) => docs.has(k)).map((k) => ({ doc: docs.get(k)!, slots: slots.get(k)! }));
    return { listings, total: slots.size };
  } catch (err) {
    console.error("[open-houses] listing lookup failed:", err);
    return { listings: [], total: 0 };
  }
});

/** Open houses in the window per feed city, for the hub page. */
export const getOpenHouseCounts = cache(async (): Promise<Map<string, number>> => {
  const counts = new Map<string, Set<string>>();
  for (const r of await rowsFor(null)) {
    if (!r.city) continue;
    counts.set(r.city, (counts.get(r.city) ?? new Set()).add(r.listing_key));
  }
  return new Map([...counts].map(([c, s]) => [c, s.size]));
});

const DAY = new Intl.DateTimeFormat("en-CA", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
const TIME = new Intl.DateTimeFormat("en-CA", { hour: "numeric", minute: "2-digit", timeZone: "America/Toronto" });

/** "Saturday, November 29". `date` is a local YYYY-MM-DD. */
export const dayLabel = (date: string) => DAY.format(new Date(`${date}T12:00:00Z`));

/** "2:30 p.m. to 4:00 p.m.", or "" without times. */
export function timeLabel(s: OpenHouseSlot): string {
  if (!s.startAt) return "";
  const a = TIME.format(new Date(s.startAt));
  return s.endAt ? `${a} to ${TIME.format(new Date(s.endAt))}` : a;
}
