/**
 * Property sale record — the subject's OWN campaign history (HouseSigma-style),
 * for the /address sale-record hero + property-history ledger.
 *
 * Data path: the campaign_history ledger (refreshCampaignHistoryForListing), which
 * reads the persisted per-property row and refreshes it on demand from the VOW feed
 * (fetchCampaignsByAddress needs EXACT RESO StreetNumber/StreetName — so both entry
 * points below resolve a raw_vow_sold payload first and derive the address fields
 * from it, never from a display-string parse).
 *
 * SERVER-ONLY, CONSUMER-ONLY: everything here is VOW Listing Information. Call
 * solely inside a getConsumer()-confirmed branch — the same structural gate as
 * getSoldGatedByKey / getStreetLedgerGated. Nothing in this module may be imported
 * from a client bundle or an anonymous render path.
 */
import { getServiceRoleClient } from "@/lib/supabase/client";
import { generatePropertyHash } from "@/lib/typesense/TemporalDistressEngine";
import { refreshCampaignHistoryForListing } from "@/lib/campaignHistory/store";
import { normalizeCampaign, type RawVowCampaign } from "@/lib/campaignHistory/normalize";
import type { CampaignEvent } from "@/lib/campaignHistory/types";
import { parseAddress, streetNamesMatch, unitsMatch, normalizeUnit } from "@/lib/watchlist/disposition";
import { localityMatch, fsaOf } from "@/lib/address/streetLedger";

/** One ledger row — a campaign at this address, ready to render. */
export interface SaleCampaignRow {
  listingKey: string;
  kind: "sold" | "leased" | "terminated" | "expired" | "suspended" | "active";
  transaction: "Sale" | "Lease";
  entryDateISO: string | null;
  endDateISO: string | null;
  /** Final ask of the campaign. */
  listPrice: number | null;
  /** First ask — differs from listPrice when the campaign had a price change. */
  originalListPrice: number | null;
  priceChangeDateISO: string | null;
  closePrice: number | null;
  brokerage: string | null;
  /** entry→end in whole days; null when either date is missing (or still active). */
  domDays: number | null;
}

/** The hero: the most recent CLOSED sale/lease at this address. */
export interface LatestSale {
  listingKey: string;
  kind: "sold" | "leased";
  closePrice: number;
  /** Ask at the time of sale (final list price). */
  askAtSale: number | null;
  /** First ask — present only when it differs from askAtSale (in-campaign change). */
  originalAsk: number | null;
  /** (close − ask) / ask × 100; null when the ask is unknown. */
  overAskPct: number | null;
  entryDateISO: string | null;
  priceChangeDateISO: string | null;
  endDateISO: string;
  domDays: number | null;
  brokerage: string | null;
  /** Previous closed SALE (never a lease) — powers the gain/appreciation facts. */
  prevSale: { closePrice: number; endDateISO: string } | null;
  /** closePrice − prevSale.closePrice. */
  gain: number | null;
  /** Compound %/yr between the two sales; null when < 1 year apart (misleading). */
  annualizedPct: number | null;
}

export interface SaleRecord {
  latestSale: LatestSale | null;
  /** Every campaign, newest first. */
  campaigns: SaleCampaignRow[];
  campaignCount: number;
}

const DAY_MS = 86_400_000;
const PROBE_LIMIT = 25;

function daysBetween(fromISO: string | null, toISO: string | null): number | null {
  if (!fromISO || !toISO) return null;
  const a = Date.parse(fromISO);
  const b = Date.parse(toISO);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null;
  return Math.round((b - a) / DAY_MS);
}

function kindOf(e: CampaignEvent): SaleCampaignRow["kind"] {
  const s = (e.end_reason ?? e.status).toLowerCase();
  return s === "sold" || s === "leased" || s === "terminated" || s === "expired" || s === "suspended"
    ? (s as SaleCampaignRow["kind"])
    : "active";
}

/** Sort key: when the campaign concluded (or started, while active). */
function eventMs(e: CampaignEvent): number {
  const t = Date.parse(e.end_date ?? e.entry_date ?? "");
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Pure assembly: ledger events → renderable record. Exported for tests.
 * Newest first; the hero is the most recent closed sale/lease with a real price;
 * appreciation compares against the previous closed SALE only (a lease price is
 * a different unit — $/mo — and must never enter the gain math).
 */
export function assembleSaleRecord(events: CampaignEvent[]): SaleRecord {
  const rows: SaleCampaignRow[] = [...events]
    .sort((a, b) => eventMs(b) - eventMs(a))
    .map((e) => {
      const kind = kindOf(e);
      return {
        listingKey: e.listing_key,
        kind,
        transaction: e.transaction_type,
        entryDateISO: e.entry_date,
        endDateISO: e.end_date,
        listPrice: e.list_price,
        originalListPrice: e.original_list_price,
        priceChangeDateISO: e.price_change_date,
        closePrice: e.close_price,
        brokerage: e.brokerage,
        domDays: kind === "active" ? null : daysBetween(e.entry_date, e.end_date),
      };
    });

  let latestSale: LatestSale | null = null;
  const heroIdx = rows.findIndex(
    (r) => (r.kind === "sold" || r.kind === "leased") && (r.closePrice ?? 0) > 0 && r.endDateISO
  );
  if (heroIdx >= 0) {
    const hero = rows[heroIdx];
    const ask = hero.listPrice ?? hero.originalListPrice;
    const originalAsk =
      hero.originalListPrice != null && ask != null && hero.originalListPrice !== ask
        ? hero.originalListPrice
        : null;
    const overAskPct = ask && ask > 0 ? ((hero.closePrice! - ask) / ask) * 100 : null;

    let prevSale: LatestSale["prevSale"] = null;
    if (hero.kind === "sold") {
      const prev = rows
        .slice(heroIdx + 1)
        .find((r) => r.kind === "sold" && r.transaction === "Sale" && (r.closePrice ?? 0) > 0 && r.endDateISO);
      if (prev) prevSale = { closePrice: prev.closePrice!, endDateISO: prev.endDateISO! };
    }

    let gain: number | null = null;
    let annualizedPct: number | null = null;
    if (prevSale) {
      gain = hero.closePrice! - prevSale.closePrice;
      const days = daysBetween(prevSale.endDateISO, hero.endDateISO);
      if (days !== null && days >= 365) {
        const years = days / 365.25;
        annualizedPct = (Math.pow(hero.closePrice! / prevSale.closePrice, 1 / years) - 1) * 100;
      }
    }

    latestSale = {
      listingKey: hero.listingKey,
      kind: hero.kind as "sold" | "leased",
      closePrice: hero.closePrice!,
      askAtSale: ask,
      originalAsk,
      overAskPct,
      entryDateISO: hero.entryDateISO,
      priceChangeDateISO: hero.priceChangeDateISO,
      endDateISO: hero.endDateISO!,
      domDays: hero.domDays,
      brokerage: hero.brokerage,
      prevSale,
      gain,
      annualizedPct,
    };
  }

  return { latestSale, campaigns: rows, campaignCount: rows.length };
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let handle: ReturnType<typeof setTimeout>;
  return Promise.race([
    p.finally(() => clearTimeout(handle)),
    new Promise<T>((_, reject) => {
      handle = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    }),
  ]);
}

/**
 * Fresh vault truth wins: replace (or add) the subject's own event in the ledger set.
 * The ledger's TTL cache can predate the sale — a row refreshed while the campaign was
 * still Active serves as-is and would render the SOLD home as "ACTIVE asked $X" (seen
 * live on 127 Via Toscana). The subject event comes straight from the raw_vow_sold
 * payload, so it always carries the closed status/price. Exported for tests.
 */
export function overlaySubjectEvent(events: CampaignEvent[], subject: CampaignEvent | null): CampaignEvent[] {
  if (!subject) return events;
  return [subject, ...events.filter((e) => e.listing_key !== subject.listing_key)];
}

/** Ledger refresh from a raw VOW payload (the exact RESO address fields). */
async function recordFromPayload(payload: Record<string, unknown>): Promise<SaleRecord | null> {
  const subject = normalizeCampaign(payload as RawVowCampaign);
  const propertyHash = generatePropertyHash(payload);
  if (!propertyHash) return subject ? assembleSaleRecord([subject]) : null;
  let events: CampaignEvent[] = subject ? [subject] : [];
  try {
    const row = await withTimeout(
      refreshCampaignHistoryForListing(getServiceRoleClient(), {
        propertyHash,
        addr: {
          StreetNumber: payload["StreetNumber"],
          StreetName: payload["StreetName"],
          City: payload["City"],
          UnitNumber: payload["UnitNumber"],
          PropertySubType: payload["PropertySubType"],
        },
        subjectEvent: subject,
        vowToken: process.env.PROPTX_VOW_TOKEN,
        nowMs: Date.now(),
      }),
      8000,
      "Campaign history"
    );
    if (row?.events?.length) events = overlaySubjectEvent(row.events, subject);
  } catch (err) {
    console.error("[saleRecord] ledger refresh failed (degrading to subject-only):", err);
  }
  if (!events.length) return null;
  return assembleSaleRecord(events);
}

/**
 * Sale record for a KNOWN sold listing key (the keyed /address page). One indexed
 * PK lookup on raw_vow_sold for the payload (single-row detoast — never a scan),
 * then the ledger refresh. Null when the key has no archived sold row.
 */
export async function getSaleRecordByKeyGated(listingKey: string): Promise<SaleRecord | null> {
  try {
    const sb = getServiceRoleClient();
    const { data } = await withTimeout(
      Promise.resolve(sb.from("raw_vow_sold").select("raw_payload").eq("listing_key", listingKey).maybeSingle()),
      4000,
      "Sold payload"
    );
    const payload = (data?.raw_payload ?? null) as Record<string, unknown> | null;
    if (!payload) return null;
    return await recordFromPayload(payload);
  } catch (err) {
    console.error(`[saleRecord] by-key fetch failed for "${listingKey}":`, err);
    return null;
  }
}

/**
 * Sale record for a display ADDRESS (the key-less profile page). Probes the sold
 * archive by street token, verifies with addressesMatch + localityMatch (the
 * geocoder-vs-feed naming landmine — see streetLedger), then reuses the newest
 * matching row's payload for the ledger refresh. Null when this address has no
 * archived sale — the Home Pulse profile simply renders without a record.
 *
 * `unit` is passed SEPARATELY because the display address usually cannot carry it: the
 * geocoder resolves "86-2945 Thomas Street" to the building ("2945 Thomas Street") and
 * drops the unit on the floor. Without it every unit in a condo block probed the same
 * civic number and took the newest sale in the building — which is exactly how unit 86
 * came to display unit 62's $690,000 close as "this home's record".
 */
export async function getSaleRecordByAddressGated(
  address: string,
  city: string,
  postal: string | null,
  unit?: string | null
): Promise<SaleRecord | null> {
  const parsed = parseAddress(`${address}, ${city}${postal ? ` ${postal}` : ""}`);
  // An explicitly resolved unit wins over whatever the display string implied.
  const subject = { ...parsed, unit: normalizeUnit(unit) || parsed.unit };
  if (!subject.streetNumber || !subject.streetName) return null;
  const token = subject.streetName.split(/\s+/).sort((a, b) => b.length - a.length)[0];
  if (!token || token.length < 3) return null;
  try {
    const sb = getServiceRoleClient();
    const safeToken = token.replace(/[%_,()]/g, "");
    // Light probe first (no raw_payload → no detoast); one-row payload fetch after.
    const { data } = await withTimeout(
      Promise.resolve(
        sb
          .from("raw_vow_sold")
          .select("listing_key, unparsed_address, city, city_region, purchase_contract_date")
          .ilike("unparsed_address", `${subject.streetNumber}%${safeToken}%`)
          .order("purchase_contract_date", { ascending: false })
          .limit(PROBE_LIMIT)
      ),
      4000,
      "Address probe"
    );
    const subjectFsa = fsaOf(subject.postal || postal);
    // addressesMatch-shaped check, but the locality leg uses localityMatch instead of
    // exact city equality — the feed files "Toronto" rows under "Toronto E01" etc.
    const hit = (data ?? []).find((r) => {
      const rowAddress = typeof r.unparsed_address === "string" ? r.unparsed_address : "";
      const parsed = parseAddress(rowAddress);
      if (!parsed.streetNumber || parsed.streetNumber !== subject.streetNumber) return false;
      // Unit before street/locality: in a condo block every other leg passes for every
      // unit, so this is the only test that distinguishes the subject from its neighbours.
      if (!unitsMatch(subject, parsed)) return false;
      if (!streetNamesMatch(subject.streetName, parsed.streetName)) return false;
      if (subject.postal && parsed.postal) return subject.postal === parsed.postal;
      return localityMatch(
        city,
        subjectFsa,
        typeof r.city === "string" ? r.city : "",
        typeof r.city_region === "string" ? r.city_region : "",
        fsaOf(parsed.postal)
      );
    });
    if (!hit?.listing_key) return null;
    return await getSaleRecordByKeyGated(String(hit.listing_key));
  } catch (err) {
    console.error(`[saleRecord] by-address fetch failed:`, err);
    return null;
  }
}
