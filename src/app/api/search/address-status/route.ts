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
import { getAddressRecordsLoose, getSoldGatedByKey, hasFullListingRow } from "@/lib/sold/soldByKey";
import { getConsumer } from "@/lib/auth/requireConsumer";
import { soldAddressHref } from "@/lib/search/searchTarget";
import type { AddressRecordResponse, AddressStatusResponse } from "@/lib/search/types";

export const dynamic = "force-dynamic"; // response depends on auth

const NOT_FOUND: AddressStatusResponse = { found: false };

// Bound the per-key gate/hasFullListingRow fan-out. An exact address rarely carries more than a
// handful of campaigns (relists); this caps a pathological match without truncating real history.
const MAX_RECORDS = 8;

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  // Address-shaped only: a civic number + a street fragment (mirrors the geo fallback).
  if (q.length < 5 || !/\d+\s+[a-zA-Z]{3,}/.test(q)) return NextResponse.json(NOT_FOUND);

  const parsed = parseAddress(q);
  const records = (await getAddressRecordsLoose(parsed)).slice(0, MAX_RECORDS);
  if (records.length === 0) return NextResponse.json(NOT_FOUND);

  const { isConsumer } = await getConsumer();

  const out: AddressRecordResponse[] = [];
  for (const r of records) {
    // Destination ladder (owner decision 2026-07-23): the FULL sold report (/properties/{key})
    // wins whenever its listings row still exists; the keyed /address page is the fallback.
    const href = (await hasFullListingRow(r.id)) ? `/properties/${r.id}` : soldAddressHref(r.address, r.city, r.id);
    const base: AddressRecordResponse = {
      key: r.id,
      address: r.address,
      city: r.city,
      dealKind: r.dealKind,
      brokerage: r.brokerage ?? undefined, // public
      href,
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
