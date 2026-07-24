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
import { getSoldPublicByAddressLoose, getSoldGatedByKey, hasFullListingRow } from "@/lib/sold/soldByKey";
import { getConsumer } from "@/lib/auth/requireConsumer";
import { soldAddressHref } from "@/lib/search/searchTarget";
import type { AddressStatusResponse } from "@/lib/search/types";

export const dynamic = "force-dynamic"; // response depends on auth

const NOT_FOUND: AddressStatusResponse = { found: false };

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  // Address-shaped only: a civic number + a street fragment (mirrors the geo fallback).
  if (q.length < 5 || !/\d+\s+[a-zA-Z]{3,}/.test(q)) return NextResponse.json(NOT_FOUND);

  const parsed = parseAddress(q);
  const pub = await getSoldPublicByAddressLoose(parsed);
  if (!pub) return NextResponse.json(NOT_FOUND);

  // Destination ladder (owner decision 2026-07-23): the FULL sold report
  // (/properties/{key} — photos, sold hero, deal analytics) is strictly richer, so it
  // wins whenever its listings row still exists; the keyed /address page is the
  // fallback for records beyond that archive.
  const href = (await hasFullListingRow(pub.id))
    ? `/properties/${pub.id}`
    : soldAddressHref(pub.address, pub.city, pub.id);

  const base: AddressStatusResponse = {
    found: true,
    key: pub.id,
    address: pub.address,
    city: pub.city,
    dealKind: pub.dealKind,
    href,
  };

  const { isConsumer } = await getConsumer();
  if (!isConsumer) return NextResponse.json(base);

  // Consumer → attach the VOW figures (best-effort; the row degrades to kind-only).
  try {
    const d = await getSoldGatedByKey(pub.id);
    if (d) {
      const isClosed = pub.dealKind === "sold" || pub.dealKind === "leased";
      return NextResponse.json({
        ...base,
        closePrice: isClosed && d.ClosePrice > 0 ? d.ClosePrice : undefined,
        soldDateMs:
          typeof d.PurchaseContractDate === "number" && d.PurchaseContractDate > 0 ? d.PurchaseContractDate : undefined,
        beds: d.BedroomsTotal || undefined,
        baths: d.BathroomsTotalInteger || undefined,
        subType: d.PropertySubType || undefined,
      } satisfies AddressStatusResponse);
    }
  } catch (err) {
    console.error("[address-status] gated fetch failed:", err);
  }
  return NextResponse.json(base);
}
