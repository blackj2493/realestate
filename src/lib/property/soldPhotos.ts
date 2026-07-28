/**
 * Photos for a SOLD/LEASED listing — the ones the detail page could never find.
 *
 * SERVER-ONLY. Sold photo URLs are VOW Listing Information (soldByKey.ts states the rule:
 * "The URL itself is a VOW field"), so nothing here may be imported into a client bundle.
 * gateVowDerived strips these before an anonymous response is built.
 *
 * WHY THIS EXISTS: sold/leased listings render from the `listings` row, whose `media_urls`
 * column is only populated while a listing is ACTIVE. A property that entered our data as
 * already-sold — or whose active-era media never landed — has an empty `media_urls` and
 * showed "NO MEDIA", while ~33 photos sat one table over in `raw_vow_sold.photos`
 * (migration 101, backfilled 288,963/288,963 rows). Measured 2026-07-27: of 87,093 sold
 * rows that render on /properties/[id], 25,335 showed nothing and 5,015 of those had
 * photos here the page simply never read.
 *
 * The remaining ~20k have no photos anywhere and must keep rendering an honest empty
 * state — this returns [] for them rather than inventing a placeholder.
 */

import { getServiceRoleClient } from "@/lib/supabase/client";

/** Row shape of raw_vow_sold.photos: [{"u": url, "c": caption?}] (migration 101). */
interface StoredPhoto {
  u?: unknown;
  c?: unknown;
}

/**
 * Photo URLs for a sold/leased listing key, in display order. Empty array when the record
 * has none (or on any failure — a gallery is never worth failing a page render over).
 */
export async function getSoldPhotoUrls(listingKey: string): Promise<string[]> {
  try {
    const supabase = getServiceRoleClient();
    const { data, error } = await supabase
      .from("raw_vow_sold")
      .select("photos")
      .eq("listing_key", listingKey)
      .maybeSingle();
    if (error || !data?.photos || !Array.isArray(data.photos)) return [];
    return (data.photos as StoredPhoto[])
      .map((p) => (typeof p?.u === "string" ? p.u.trim() : ""))
      .filter((u): u is string => u.length > 0);
  } catch {
    return [];
  }
}
