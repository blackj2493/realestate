/**
 * Street sale ledger — every recorded sale on the subject's STREET from the full
 * raw_vow_sold archive (~2yr+), for the address-profile "street ledger" card.
 *
 * SERVER-ONLY (service-role Supabase). THE GATE IS STRUCTURAL:
 *  - getStreetLedgerPublic() → COUNT only. A sale count is the established anon
 *    teaser (SaleHistorySection: "N prior sales on record"); no price, date, year,
 *    or address ever reaches the anonymous render path.
 *  - getStreetLedgerGated() → full rows; call ONLY after getConsumer() confirms a
 *    registered consumer.
 *
 * LOCALITY RULE (the fragmented-market landmine, see [[region-aliases-fragmented-markets]]):
 * the profile's city comes from the GEOCODER's municipal naming ("Nepean"), while the
 * VOW feed files the same street under OREB area names ("Barrhaven") — an exact city
 * filter finds NOTHING. So the SQL filters by street token only, and rows are verified
 * in JS: strict street-name match (streetNamesMatch) + a locality check that accepts
 * postal-FSA equality first, then city equality/prefix, then shared Ottawa-group
 * membership. Flat-column ilike scan (NO raw_payload → no detoast), cached 6h per
 * (street, city, fsa) so the force-dynamic profile page doesn't re-scan 280k rows.
 */
import { unstable_cache } from "next/cache";
import { getServiceRoleClient } from "@/lib/supabase/client";
import { parseAddress, streetNamesMatch } from "@/lib/watchlist/disposition";
import { OTTAWA_AREAS } from "@/lib/dashboard/ottawaAreas";

/** Leases live in raw_vow_sold too — same sale floor the AVM/metrics paths use. */
const MIN_SALE_PRICE = 50_000;
const MAX_SALES = 80;
const SCAN_LIMIT = 200; // headroom: the street token can match other municipalities
const CACHE_SECONDS = 6 * 3600;

const OTTAWA_SET = new Set(OTTAWA_AREAS.map((a) => a.toLowerCase()));

export interface LedgerSale {
  listingKey: string;
  /** Street address only ("761 Cappamore Drive"). */
  address: string;
  closePrice: number;
  /** Date-only ISO string ("2024-05-13") — render with timeZone:'UTC' (MEDIUM-18). */
  dateISO: string;
  subType: string | null;
}

export interface StreetLedgerGated {
  streetLabel: string;
  count: number;
  /** Newest first, capped at MAX_SALES post-verification. */
  sales: LedgerSale[];
}

export interface StreetLedgerPublic {
  streetLabel: string;
  count: number;
}

/** Longest distinctive street token (≥4 chars) for the SQL ilike probe. */
function probeToken(streetName: string): string | null {
  const tokens = streetName.split(/\s+/).filter((t) => t.length >= 4);
  if (!tokens.length) return null;
  return tokens.sort((a, b) => b.length - a.length)[0];
}

/** "K2J 6W3" / "k2j6w3" → "K2J"; null when unusable. Exported for tests. */
export function fsaOf(postal: string | null | undefined): string | null {
  const p = (postal ?? "").replace(/\s+/g, "").toUpperCase();
  return /^[A-Z]\d[A-Z]/.test(p) ? p.slice(0, 3) : null;
}

/**
 * Same locality? Geocoder city vs feed OREB naming never string-matches reliably, so:
 * FSA equality (strongest) → city equality/prefix ("Toronto" vs "Toronto C01",
 * "London" vs "London South") → both sides members of the Ottawa area group.
 * Exported for tests.
 */
export function localityMatch(
  profileCity: string,
  profileFsa: string | null,
  rowCity: string,
  rowRegion: string,
  rowFsa: string | null
): boolean {
  if (profileFsa && rowFsa && profileFsa === rowFsa) return true;
  const pc = profileCity.toLowerCase().trim();
  for (const rc of [rowCity.toLowerCase().trim(), rowRegion.toLowerCase().trim()]) {
    if (!rc || !pc) continue;
    if (rc === pc) return true;
    if (pc.length >= 4 && (rc.startsWith(pc) || pc.startsWith(rc))) return true;
    if (OTTAWA_SET.has(rc) && (pc === "ottawa" || OTTAWA_SET.has(pc))) return true;
  }
  return false;
}

const fetchLedger = unstable_cache(
  async (streetName: string, city: string, fsa: string | null): Promise<StreetLedgerGated | null> => {
    const token = probeToken(streetName);
    if (!token) return null;
    try {
      const sb = getServiceRoleClient();
      const safeToken = token.replace(/[%_,()]/g, "");
      const { data, error } = await sb
        .from("raw_vow_sold")
        .select("listing_key, unparsed_address, city, city_region, close_price, purchase_contract_date, property_sub_type")
        .ilike("unparsed_address", `%${safeToken}%`)
        .gte("close_price", MIN_SALE_PRICE)
        .order("purchase_contract_date", { ascending: false })
        .limit(SCAN_LIMIT);
      if (error || !data) {
        if (error) console.error("[streetLedger] query failed:", error.message);
        return null;
      }

      const sales: LedgerSale[] = [];
      for (const r of data as Array<Record<string, unknown>>) {
        const rowAddress = typeof r.unparsed_address === "string" ? r.unparsed_address : "";
        const parsed = parseAddress(rowAddress);
        if (!streetNamesMatch(streetName, parsed.streetName)) continue;
        if (
          !localityMatch(
            city,
            fsa,
            typeof r.city === "string" ? r.city : "",
            typeof r.city_region === "string" ? r.city_region : "",
            fsaOf(parsed.postal)
          )
        )
          continue;
        const close = Number(r.close_price); // NUMERIC arrives as a string via PostgREST
        const dateISO = typeof r.purchase_contract_date === "string" ? r.purchase_contract_date : "";
        if (!(close >= MIN_SALE_PRICE) || !dateISO) continue;
        sales.push({
          listingKey: String(r.listing_key ?? ""),
          address: rowAddress.split(",")[0].trim(),
          closePrice: close,
          dateISO: dateISO.slice(0, 10),
          subType: typeof r.property_sub_type === "string" && r.property_sub_type ? r.property_sub_type : null,
        });
        if (sales.length >= MAX_SALES) break;
      }

      // Title-case the street for display ("cappamore drive" → "Cappamore Drive").
      const streetLabel = streetName.replace(/\b[a-z]/g, (c) => c.toUpperCase());
      return { streetLabel, count: sales.length, sales };
    } catch (err) {
      console.error("[streetLedger] failed:", err);
      return null;
    }
  },
  ["street-ledger"],
  { revalidate: CACHE_SECONDS }
);

/** Parse the subject street; null when the address has no usable street name. */
function subjectStreet(address: string, city: string): string | null {
  const parsed = parseAddress(`${address}, ${city}`);
  return parsed.streetName || null;
}

/** CONSUMER-ONLY full ledger. Call only inside a getConsumer()-confirmed branch. */
export async function getStreetLedgerGated(
  address: string,
  city: string,
  postal: string | null
): Promise<StreetLedgerGated | null> {
  const street = subjectStreet(address, city);
  if (!street) return null;
  return fetchLedger(street, city, fsaOf(postal));
}

/** Anonymous-safe: sale COUNT + street label only — no values leave this function. */
export async function getStreetLedgerPublic(
  address: string,
  city: string,
  postal: string | null
): Promise<StreetLedgerPublic | null> {
  const street = subjectStreet(address, city);
  if (!street) return null;
  const full = await fetchLedger(street, city, fsaOf(postal));
  if (!full) return null;
  return { streetLabel: full.streetLabel, count: full.count };
}
