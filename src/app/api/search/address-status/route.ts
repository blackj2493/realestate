/**
 * GET /api/search/address-status?q=<typed address> — the search dropdown's sold-record
 * probe. Answers "does this exact typed address have a sold/leased/off-market record?"
 * so the suggest UI can render a real SOLD row instead of the misleading geocoded
 * "Not on the market" fallback.
 *
 * GATE (structural, same rules as the /address page):
 *  - The lookup itself (getSoldPublicByAddressLoose) returns PUBLIC fields only — the
 *    status KIND is the one public signal on a sold record (audit R24a: the same badge
 *    /address shows anon). No date reaches an anonymous payload.
 *  - VOW values (close price, sold date, beds/baths) are fetched via getSoldGatedByKey
 *    ONLY inside the getConsumer()-confirmed branch — never for anon.
 *
 * Prefix-tolerant on purpose (mid-keystroke queries: "127 via to") — suggestion surface
 * only; canonical resolution stays on the strict ladder (resolveAddressSlug).
 */
import { NextRequest, NextResponse } from "next/server";
import { parseAddress } from "@/lib/watchlist/disposition";
import { getAddressRecordsLoose, getStreetRecordsLoose, getSoldGatedByKey, hasFullListingRow } from "@/lib/sold/soldByKey";
import { getConsumer } from "@/lib/auth/requireConsumer";
import { soldAddressHref } from "@/lib/search/searchTarget";
import { findActiveAtAddress, type ActiveAtAddress } from "@/lib/search/activeAtAddress";
import type { AddressRecordResponse, AddressStatusResponse } from "@/lib/search/types";

export const dynamic = "force-dynamic"; // response depends on auth

const NOT_FOUND: AddressStatusResponse = { found: false };

// Bound the per-key gate/hasFullListingRow fan-out. An exact address rarely carries more than a
// handful of campaigns (relists); this caps a pathological match without truncating real history.
const MAX_RECORDS = 8;
// A street query answers "which homes here have history", so it needs more rows than one
// address does — but it also fires on far more queries, hence a hard ceiling.
const MAX_STREET_RECORDS = 12;

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  const addressShaped = /\d+\s+[a-zA-Z]{3,}/.test(q);
  // A STREET name with no civic number ("cappam") used to return nothing at all, so a home's
  // history was reachable only by knowing its number. Bounded deliberately: one row per
  // address, capped, and served from the rolling sold cache rather than the archive scan.
  const streetShaped = !/\d/.test(q) && /^[a-zA-Z][a-zA-Z '.-]{3,}$/.test(q);
  if (q.length < 4 || (!addressShaped && !streetShaped)) return NextResponse.json(NOT_FOUND);

  const parsed = parseAddress(q);
  const records = addressShaped
    ? (await getAddressRecordsLoose(parsed)).slice(0, MAX_RECORDS)
    : await getStreetRecordsLoose(q, MAX_STREET_RECORDS);
  if (records.length === 0) return NextResponse.json(NOT_FOUND);

  const { isConsumer } = await getConsumer();

  // Relist join, resolved ONCE per distinct address: records at one address are usually
  // successive campaigns on the same home, so the per-record fan-out collapses to a
  // single lookup in the common case.
  const liveByAddress = new Map<string, ActiveAtAddress | null>();
  const liveFor = async (r: (typeof records)[number]): Promise<ActiveAtAddress | null> => {
    const cacheKey = r.address.trim().toLowerCase();
    if (!liveByAddress.has(cacheKey)) liveByAddress.set(cacheKey, await findActiveAtAddress(r.address, r.id));
    return liveByAddress.get(cacheKey) ?? null;
  };

  const out: AddressRecordResponse[] = [];
  for (const r of records) {
    const live = await liveFor(r);
    // An OFF MARKET record is a campaign that ended — it never closed, so it has no price
    // or date of its own to show. When the same home is listed again, the live listing is
    // the only useful destination; sending people to the cancelled campaign is a dead end
    // (owner, 2026-08-10). SOLD / LEASED records keep their own page: there the close
    // price IS the answer, and `liveKey` still lets the UI say it's back on the market.
    const forwardsToLive = r.dealKind === "offmarket" && !!live;
    // Destination ladder (owner decision 2026-07-23): the FULL sold report (/properties/{key})
    // wins whenever its listings row still exists; the keyed /address page is the fallback.
    const href = forwardsToLive
      ? `/properties/${live!.key}`
      : (await hasFullListingRow(r.id))
        ? `/properties/${r.id}`
        : soldAddressHref(r.address, r.city, r.id);
    const base: AddressRecordResponse = {
      key: r.id,
      address: r.address,
      city: r.city,
      cityRegion: r.cityRegion || undefined,
      dealKind: r.dealKind,
      brokerage: r.brokerage ?? undefined, // public
      hasPhoto: r.hasPhoto || undefined, // existence bit; the URL itself is VOW
      href,
      // Public IDX (active key + asking price) — safe on the anonymous branch below.
      liveKey: live?.key,
      livePrice: live && live.listPrice > 0 ? live.listPrice : undefined,
      liveTransactionType: live?.transactionType || undefined,
    };
    if (!isConsumer) {
      out.push(base);
      continue;
    }
    // Consumer → attach the VOW figures per key (best-effort; degrades to kind-only).
    try {
      const d = await getSoldGatedByKey(r.id);
      if (d) {
        const isClosed = r.dealKind === "sold" || r.dealKind === "leased";
        out.push({
          ...base,
          closePrice: isClosed && d.ClosePrice > 0 ? d.ClosePrice : undefined,
          soldDateMs:
            typeof d.PurchaseContractDate === "number" && d.PurchaseContractDate > 0 ? d.PurchaseContractDate : undefined,
          beds: d.BedroomsTotal || undefined,
          baths: d.BathroomsTotalInteger || undefined,
          subType: d.PropertySubType || undefined,
        });
        continue;
      }
    } catch (err) {
      console.error("[address-status] gated fetch failed:", err);
    }
    out.push(base);
  }

  // Flat primary (= records[0]) kept for the header bar's simple kind-aware label.
  return NextResponse.json({ found: true, ...out[0], records: out } satisfies AddressStatusResponse);
}
