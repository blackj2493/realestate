/**
 * POST /api/watchlist/dispositions
 *
 * Resolves WHY each off-market saved listing left the active index — the signal the
 * dashboard's "Since your last visit" feed needs to stop lumping sold, relisted, and
 * terminated listings into one "Off-market" bucket (useWatchlistSnapshot only knows the
 * coarse "MLS key vanished from `properties`" fact).
 *
 * For each off-market key the caller sends, this route:
 *   1. looks it up in the `sold_listings` collection (admin key) for the exact DealType
 *      (sold / leased / terminated / expired / suspended); and
 *   2. re-looks-up the ACTIVE `properties` index by the saved address to detect a RELIST
 *      — the same physical address live again under a new MLS# (terminate-then-relist).
 * The pure classifier (lib/watchlist/disposition.ts) then resolves the disposition.
 *
 * COMPLIANCE (CLAUDE.md §4 / lib/property/listingStatus.ts gateListingStatus):
 *   - `sold_listings` is VOW data → read SERVER-SIDE ONLY with the admin key, never the
 *     public browser key.
 *   - Only the disposition KIND crosses to the client (the SOLD / OFF-MARKET badge is
 *     public — HouseSigma model). NO VOW numbers (close price, sold date) are returned.
 *   - The SPECIFIC de-list reason (Terminated/Expired/Suspended) is VOW-gated, so it is
 *     collapsed to a generic "off-market" for non-consumers (mirrors gateListingStatus).
 *   - Relist fields come from the ACTIVE (public IDX) listing → display-safe for everyone.
 * Deterministic throughout (no LLM).
 */

import { NextRequest, NextResponse } from "next/server";
import Typesense, { Client } from "typesense";
import { SOLD_LISTINGS_COLLECTION } from "@/lib/typesense/soldListingsSchema";
import { getConsumer } from "@/lib/auth/requireConsumer";
import { getServiceRoleClient } from "@/lib/supabase/client";
import {
  addressesMatch,
  classifyDisposition,
  parseAddress,
  resolveDealType,
  vaultTransaction,
  type Disposition,
  type RelistTarget,
  type SoldDealType,
} from "@/lib/watchlist/disposition";

export const dynamic = "force-dynamic";

const TYPESENSE_HOST = "9uyapwh6e5qmvl34p-1.a1.typesense.net";
const TYPESENSE_PORT = 443;

// Same TRREB listing-key shape useWatchlistSnapshot trusts (board letter + 5–10 digits).
const KEY_RE = /^[A-Za-z]\d{5,10}$/;
// Off-market sets are small; bound the work so a malformed payload can't fan out.
const MAX_ITEMS = 60;
const RELIST_CANDIDATES_PER_ADDRESS = 25;

let adminClient: Client | null = null;

/** Server-only Typesense client (admin key) — must never run in the browser. */
function getAdminClient(): Client {
  if (!adminClient) {
    const key = process.env.TYPESENSE_ADMIN_API_KEY;
    if (!key) throw new Error("TYPESENSE_ADMIN_API_KEY is not set");
    adminClient = new Typesense.Client({
      nodes: [{ host: TYPESENSE_HOST, port: TYPESENSE_PORT, protocol: "https" }],
      apiKey: key,
      connectionTimeoutSeconds: 10,
    });
  }
  return adminClient;
}

interface ReqItem {
  listing_key: string;
  address: string | null;
}

const DEAL_TYPES = new Set(["sold", "leased", "terminated", "expired", "suspended"]);

/** A doc present in `sold_listings` means a transaction/de-list; an absent DealType is
 *  legacy and was only ever omitted on sold rows, so it defaults to 'sold'. */
function normalizeDealType(v: unknown): SoldDealType {
  const s = String(v ?? "").toLowerCase().trim();
  if (DEAL_TYPES.has(s)) return s as SoldDealType;
  return "sold";
}

/** Read the exact disposition + address for each key from `sold_listings`. */
async function fetchSoldMap(
  keys: string[]
): Promise<Map<string, { dealType: SoldDealType; address: string | null }>> {
  const map = new Map<string, { dealType: SoldDealType; address: string | null }>();
  if (!keys.length) return map;
  const res = await getAdminClient()
    .collections(SOLD_LISTINGS_COLLECTION)
    .documents()
    .search({
      q: "*",
      query_by: "UnparsedAddress", // required syntactically; ignored for q:"*"
      filter_by: `id:[${keys.join(",")}]`,
      include_fields: "id,DealType,UnparsedAddress",
      per_page: Math.min(keys.length, 250),
    });
  for (const h of res.hits ?? []) {
    const d = h.document as { id: string; DealType?: unknown; UnparsedAddress?: string };
    map.set(d.id, { dealType: normalizeDealType(d.DealType), address: d.UnparsedAddress ?? null });
  }
  return map;
}

/**
 * Recover a disposition by ADDRESS for keys whose exact id ISN'T in sold_listings — a
 * property routinely sells or terminates under a DIFFERENT MLS# than the one you saved
 * (e.g. saved key N13410488, but the campaign that hit the feed at that address is
 * N13135326). One multi_search; per address the most recent event wins (max
 * PurchaseContractDate — the field is the sold-firm OR de-list date). Matched on civic
 * number + postal/city so a neighbour at the same street never bleeds in.
 */
async function fetchSoldByAddress(
  candidates: Array<{ key: string; address: string | null }>
): Promise<Map<string, SoldDealType>> {
  const out = new Map<string, SoldDealType>();
  const usable = candidates
    .map((c) => ({ ...c, parsed: parseAddress(c.address) }))
    .filter((c) => c.parsed.streetNumber && c.parsed.streetName);
  if (!usable.length) return out;

  const searches = usable.map((c) => ({
    collection: SOLD_LISTINGS_COLLECTION,
    q: `${c.parsed.streetNumber} ${c.parsed.streetName}`.trim(),
    query_by: "UnparsedAddress",
    include_fields: "id,DealType,UnparsedAddress,PurchaseContractDate",
    per_page: 25,
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res: any = await getAdminClient().multiSearch.perform({ searches } as any);
  const results: Array<{
    hits?: Array<{ document: { DealType?: unknown; UnparsedAddress?: string; PurchaseContractDate?: number } }>;
  }> = res?.results ?? [];

  usable.forEach((c, i) => {
    // Prefer a real transaction (sold/leased) over any de-list at the same address, and
    // only then the most recent — so a terminated DUPLICATE campaign dated after the sale
    // can't mask it. Within the same class, newest wins.
    let best: { dealType: SoldDealType; date: number; isTxn: boolean } | null = null;
    for (const h of results[i]?.hits ?? []) {
      const d = h.document;
      if (!addressesMatch(c.parsed, parseAddress(d.UnparsedAddress))) continue;
      const dealType = normalizeDealType(d.DealType);
      const isTxn = dealType === "sold" || dealType === "leased";
      const date = typeof d.PurchaseContractDate === "number" ? d.PurchaseContractDate : 0;
      if (
        !best ||
        (isTxn && !best.isTxn) ||
        (isTxn === best.isTxn && date > best.date)
      ) {
        best = { dealType, date, isTxn };
      }
    }
    if (best) out.set(c.key, best.dealType);
  });

  return out;
}

/**
 * Read each saved key's OWN status from the Supabase `listings` vault
 * (full_payload->>MlsStatus) and keep only confirmed sales/leases. This is the same
 * authoritative source the detail page and the nightly alert worker (scripts/worker/
 * alerts.ts) consult, and it closes the gap where a sold campaign never reached the
 * Typesense sold_listings collection (terminate-then-relist-then-sold: the sale lives
 * only in the vault, under the NEW MLS# the user actually saved). Server-side + service
 * role; only the disposition KIND ("sold"/"leased") crosses to the client — no VOW
 * numbers — so this stays compliant with gateListingStatus (same as sold_listings).
 */
async function fetchVaultDeals(keys: string[]): Promise<Map<string, "sold" | "leased">> {
  const out = new Map<string, "sold" | "leased">();
  if (!keys.length) return out;
  try {
    const { data } = await getServiceRoleClient()
      .from("listings")
      .select("listing_key, status:full_payload->>MlsStatus")
      .in("listing_key", keys);
    for (const row of (data ?? []) as Array<{ listing_key: string; status: string | null }>) {
      const txn = vaultTransaction(row.status);
      if (txn) out.set(row.listing_key, txn);
    }
  } catch (e) {
    // Best-effort fallback — never fail the route (or the dashboard) over the vault read.
    console.error("[watchlist/dispositions] vault", e instanceof Error ? e.message : e);
  }
  return out;
}

interface ActiveHit {
  id: string;
  UnparsedAddress?: string;
  PostalCode?: string;
  ListPrice?: number;
  EntryTimestamp?: number;
}

/** Parse an active doc's address, backfilling the postal from its PostalCode field. */
function parseActive(doc: ActiveHit) {
  const p = parseAddress(doc.UnparsedAddress);
  if (!p.postal && doc.PostalCode) p.postal = String(doc.PostalCode).replace(/\s+/g, "").toUpperCase();
  return p;
}

/**
 * Find the live relist for each candidate address in ONE multi_search round-trip.
 * Returns a map keyed by listing_key → the best-matching active listing (≠ the saved
 * key), preferring an exact postal match, then the most recently listed.
 */
async function fetchRelists(
  candidates: Array<{ key: string; address: string | null }>
): Promise<Map<string, RelistTarget>> {
  const out = new Map<string, RelistTarget>();
  const usable = candidates
    .map((c) => ({ ...c, parsed: parseAddress(c.address) }))
    .filter((c) => c.parsed.streetNumber); // a civic number is the minimum to match on
  if (!usable.length) return out;

  const searches = usable.map((c) => ({
    collection: "properties",
    q: `${c.parsed.streetNumber} ${c.parsed.streetName}`.trim() || "*",
    query_by: "UnparsedAddress",
    include_fields: "id,UnparsedAddress,PostalCode,ListPrice,EntryTimestamp",
    per_page: RELIST_CANDIDATES_PER_ADDRESS,
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res: any = await getAdminClient().multiSearch.perform({ searches } as any);
  const results: Array<{ hits?: Array<{ document: ActiveHit }> }> = res?.results ?? [];

  usable.forEach((c, i) => {
    const hits = results[i]?.hits ?? [];
    let best: { doc: ActiveHit; exact: boolean } | null = null;
    for (const h of hits) {
      const doc = h.document;
      if (!doc?.id || doc.id === c.key) continue; // never match the dead key back to itself
      const cand = parseActive(doc);
      if (!addressesMatch(c.parsed, cand)) continue;
      const exact = !!c.parsed.postal && c.parsed.postal === cand.postal;
      if (
        !best ||
        (exact && !best.exact) ||
        (exact === best.exact && (doc.EntryTimestamp ?? 0) > (best.doc.EntryTimestamp ?? 0))
      ) {
        best = { doc, exact };
      }
    }
    if (best) {
      out.set(c.key, {
        newKey: best.doc.id,
        newPrice: typeof best.doc.ListPrice === "number" ? best.doc.ListPrice : null,
        newAddress: best.doc.UnparsedAddress ?? null,
      });
    }
  });

  return out;
}

/** Strip the VOW-gated specific de-list reason for non-consumers (gateListingStatus parity). */
function gate(disp: Disposition, isConsumer: boolean): Disposition {
  if (isConsumer) return disp;
  if (disp.kind === "off-market" && disp.reason !== "gone") return { kind: "off-market", reason: "gone" };
  return disp;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { items?: unknown };
    const rawItems = Array.isArray(body.items) ? body.items : [];

    // Validate + dedupe by key, keeping only well-formed TRREB keys.
    const items = new Map<string, ReqItem>();
    for (const it of rawItems) {
      if (items.size >= MAX_ITEMS) break;
      const key = String((it as { listing_key?: unknown })?.listing_key ?? "").trim();
      if (!KEY_RE.test(key) || items.has(key)) continue;
      const addrRaw = (it as { address?: unknown })?.address;
      items.set(key, { listing_key: key, address: typeof addrRaw === "string" ? addrRaw : null });
    }
    if (items.size === 0) return NextResponse.json({ dispositions: {} });

    const keys = [...items.keys()];
    const [soldMap, vaultMap] = await Promise.all([
      fetchSoldMap(keys),
      fetchVaultDeals(keys),
    ]);

    // Recover a disposition by ADDRESS for any key not already CONFIRMED as a sale/lease
    // by its exact sold_listings record. This now also runs for keys recorded as a de-list
    // (terminated/expired/suspended) so a sale that closed under a different MLS# at the
    // same address can override that stale de-list. Prefer the authoritative sold_listings
    // address, else the saved address.
    const addrSoldMap = await fetchSoldByAddress(
      keys
        .filter((k) => {
          const exact = soldMap.get(k)?.dealType;
          return exact !== "sold" && exact !== "leased";
        })
        .map((k) => ({ key: k, address: soldMap.get(k)?.address ?? items.get(k)!.address }))
    );
    const dealTypeFor = (key: string): SoldDealType =>
      resolveDealType({
        exact: soldMap.get(key)?.dealType ?? null,
        vault: vaultMap.get(key) ?? null,
        addr: addrSoldMap.get(key) ?? null,
      });

    // Only listings that did NOT confirm a sale/lease can be a relist; resolve those.
    const relistCandidates: Array<{ key: string; address: string | null }> = [];
    for (const key of keys) {
      const dealType = dealTypeFor(key);
      if (dealType === "sold" || dealType === "leased") continue;
      // Prefer the authoritative sold_listings address, else the saved address.
      relistCandidates.push({ key, address: soldMap.get(key)?.address ?? items.get(key)!.address });
    }
    const relistMap = await fetchRelists(relistCandidates);

    const { isConsumer } = await getConsumer();

    const dispositions: Record<string, Disposition> = {};
    for (const key of keys) {
      const disp = classifyDisposition({
        soldDealType: dealTypeFor(key),
        relist: relistMap.get(key) ?? null,
      });
      dispositions[key] = gate(disp, isConsumer);
    }

    return NextResponse.json({ dispositions });
  } catch (e) {
    // Best-effort: never break the dashboard — an empty map degrades to the generic
    // "Off-market" the feed already showed before this route existed.
    console.error("[watchlist/dispositions]", e instanceof Error ? e.message : e);
    return NextResponse.json({ dispositions: {} });
  }
}
