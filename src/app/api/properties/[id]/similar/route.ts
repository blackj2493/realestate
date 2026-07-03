/**
 * GET /api/properties/[id]/similar
 *
 * Two area-scoped comparable lists for the listing page's "comparable properties"
 * band: For Sale (IDX, `properties` collection, ungated) and Recently Sold (VOW,
 * `sold_listings`, gated). Subject match attributes arrive as query params (the
 * subject's own public fields, already on the page) so the endpoint is
 * status-agnostic — a sold/delisted subject may be purged from `properties`.
 *
 * Compliance: sold rows are VOW Listing Information — anonymous users get the
 * count but ZERO rows (rows discarded server-side, like /api/market/activity/sold).
 * Brokerage rides every For-Sale card. Ranking is deterministic (no LLM, §4).
 */
import { NextRequest, NextResponse } from "next/server";
import Typesense, { Client } from "typesense";
import { getTypesenseClient } from "@/lib/typesense/client";
import { getConsumer } from "@/lib/auth/requireConsumer";
import { SOLD_LISTINGS_COLLECTION } from "@/lib/typesense/soldListingsSchema";
import { mapSoldDoc } from "@/app/api/market/activity/sold/soldMapper";
import {
  buildForSaleSimilarFilter,
  buildSoldSimilarFilter,
  rankSimilar,
  classifyMatchQuality,
  buildAttrDeltas,
  splitBeds,
  type SubjectAttrs,
  type CandidateAttrs,
  type MatchTier,
  type RankedSimilar,
  type AttrDelta,
  type DeltaInput,
} from "@/lib/property/similarListings";

export const dynamic = "force-dynamic";

const FORSALE_COLLECTION = "properties";
const CANDIDATE_FETCH = 80;
const RESULT_LIMIT = 8;
const SOLD_WINDOW_DAYS = 180;
// BuildingAreaTotal is stored-but-undeclared on the active index — include_fields
// still returns stored fields, and commercial listings (unlike houses) fill it, so
// commercial comps can score on area (commercial-gap Phase 1).
const FORSALE_FIELDS =
  "id,ListPrice,UnparsedAddress,City,CityRegion,PropertySubType,BedroomsTotal,BedroomsAboveGrade,BedroomsBelowGrade,BathroomsTotalInteger,ParkingTotal,CoveredSpaces,BuildingAreaTotal,ListOfficeName,primaryImageUrl,RawImages,calculatedDOM";

const TYPESENSE_HOST = "9uyapwh6e5qmvl34p-1.a1.typesense.net";
const TYPESENSE_PORT = 443;

let soldClient: Client | null = null;
function getSoldClient(): Client {
  if (!soldClient) {
    const key = process.env.TYPESENSE_ADMIN_API_KEY;
    if (!key) throw new Error("TYPESENSE_ADMIN_API_KEY is not set");
    soldClient = new Typesense.Client({
      nodes: [{ host: TYPESENSE_HOST, port: TYPESENSE_PORT, protocol: "https" }],
      apiKey: key,
      connectionTimeoutSeconds: 10,
    });
  }
  return soldClient;
}

export interface SimilarForSaleCard {
  id: string;
  address: string;
  city: string | null;
  price: number;
  beds: number;
  bedsAbove: number;
  bedsBelow: number;
  baths: number;
  propertySubType: string | null;
  brokerage: string | null;
  thumb: string | null;
  daysOnMarket: number | null;
  why: string;
  deltas: AttrDelta[];
}

export interface SimilarSoldCard {
  id: string;
  address: string;
  city: string | null;
  closePrice: number;
  listPrice: number | null;
  soldDate: string | null;
  beds: number | null;
  bedsAbove: number | null;
  bedsBelow: number | null;
  baths: number | null;
  propertySubType: string | null;
  brokerage: string | null;
  thumb: string | null;
  pctOfAsk: number | null;
  why: string;
  deltas: AttrDelta[];
}

type Doc = Record<string, unknown>;
const numField = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);

// CoveredSpaces is an optional index field: undefined → unknown (neutral score),
// a present number (including 0 = no garage) → a real value.
const garageField = (v: unknown): number | null => (v == null ? null : numField(v));

function forSaleAttrs(d: Doc): CandidateAttrs {
  const { above, below } = splitBeds({
    total: numField(d.BedroomsTotal),
    above: d.BedroomsAboveGrade as number | undefined,
    below: d.BedroomsBelowGrade as number | undefined,
  });
  return {
    cityRegion: (d.CityRegion as string) || null,
    subType: (d.PropertySubType as string) || null,
    beds: numField(d.BedroomsTotal),
    bedsAbove: above,
    bedsBelow: below,
    garage: garageField(d.CoveredSpaces),
    price: numField(d.ListPrice),
    // ~Never filled for houses (sizeScore stays neutral there), but commercial
    // listings carry it and the commercial scorer weights it heavily.
    area: numField(d.BuildingAreaTotal),
  };
}

function soldAttrs(d: Doc, nowMs: number): CandidateAttrs {
  const ms = Number(d.PurchaseContractDate);
  const daysAgo = Number.isFinite(ms) && ms > 0 ? (nowMs - ms) / 86_400_000 : 999;
  const { above, below } = splitBeds({
    total: numField(d.BedroomsTotal),
    above: d.BedroomsAboveGrade as number | undefined,
    below: d.BedroomsBelowGrade as number | undefined,
  });
  return {
    cityRegion: (d.CityRegion as string) || null,
    subType: (d.PropertySubType as string) || null,
    beds: numField(d.BedroomsTotal),
    bedsAbove: above,
    bedsBelow: below,
    garage: garageField(d.CoveredSpaces),
    price: numField(d.ClosePrice),
    area: numField(d.BuildingAreaTotal),
    daysAgo,
  };
}

function toForSaleCard(r: RankedSimilar<Doc>, subject: DeltaInput): SimilarForSaleCard {
  const d = r.item;
  const imgs = Array.isArray(d.RawImages) ? (d.RawImages as string[]) : [];
  const beds = numField(d.BedroomsTotal);
  const { above: bedsAbove, below: bedsBelow } = splitBeds({
    total: beds,
    above: d.BedroomsAboveGrade as number | undefined,
    below: d.BedroomsBelowGrade as number | undefined,
  });
  const baths = numField(d.BathroomsTotalInteger);
  const price = numField(d.ListPrice);
  return {
    id: String(d.id),
    address: (d.UnparsedAddress as string) || "",
    city: (d.City as string) || null,
    price,
    beds,
    bedsAbove,
    bedsBelow,
    baths,
    propertySubType: (d.PropertySubType as string) || null,
    brokerage: (d.ListOfficeName as string) || null,
    thumb: (d.primaryImageUrl as string) || imgs[0] || null,
    daysOnMarket: Number.isFinite(Number(d.calculatedDOM)) ? Number(d.calculatedDOM) : null,
    why: r.why,
    // For-Sale comps list-vs-list, so price delta is a clean comparison → include it.
    deltas: buildAttrDeltas(subject, { beds, baths, price, area: 0 }, { includePrice: true }),
  };
}

function toSoldCard(r: RankedSimilar<Doc>, subject: DeltaInput): SimilarSoldCard {
  const m = mapSoldDoc(r.item);
  const pctOfAsk = m.listPrice && m.listPrice > 0 ? (m.closePrice / m.listPrice) * 100 : null;
  return {
    id: m.id,
    address: m.address,
    city: m.city,
    closePrice: m.closePrice,
    listPrice: m.listPrice,
    soldDate: m.soldDate,
    beds: m.beds,
    bedsAbove: m.bedsAbove,
    bedsBelow: m.bedsBelow,
    baths: m.baths,
    propertySubType: m.propertySubType,
    brokerage: m.brokerage,
    thumb: m.primaryImageUrl,
    pctOfAsk,
    why: r.why,
    // Sold: skip the price chip (close-vs-list is muddy; "% of ask" conveys it instead).
    deltas: buildAttrDeltas(
      subject,
      { beds: m.beds ?? 0, baths: m.baths ?? 0, price: m.closePrice, area: m.sqft ?? 0 },
      { includePrice: false }
    ),
  };
}

const numParam = (v: string | null): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sp = new URL(req.url).searchParams;
  const { above: subjAbove, below: subjBelow } = splitBeds({
    total: numParam(sp.get("beds")),
    above: sp.get("bedsAbove") != null ? numParam(sp.get("bedsAbove")) : undefined,
    below: sp.get("bedsBelow") != null ? numParam(sp.get("bedsBelow")) : undefined,
  });
  const subject: SubjectAttrs = {
    id,
    cityRegion: (sp.get("cityRegion") || "").trim() || null,
    city: (sp.get("city") || "").trim() || null,
    subType: (sp.get("subType") || "").trim() || null,
    beds: numParam(sp.get("beds")),
    bedsAbove: subjAbove,
    bedsBelow: subjBelow,
    // Absent param → unknown garage (neutral); present (incl. "0") → real value.
    garage: sp.get("garage") != null && sp.get("garage") !== "" ? numParam(sp.get("garage")) : null,
    listPrice: numParam(sp.get("listPrice")),
    area: numParam(sp.get("area")),
  };
  // Commercial subject → area/price/region scoring (no beds/garage); lease subject →
  // comp against For-Lease inventory instead of For-Sale (commercial-gap Phase 1).
  const isCommercial = sp.get("commercial") === "1";
  const isLease = sp.get("lease") === "1";
  // Subject shape for the per-card "vs this home" delta chips (baths isn't a scoring signal).
  const subjectDelta: DeltaInput = {
    beds: subject.beds,
    baths: numParam(sp.get("baths")),
    price: subject.listPrice,
    area: subject.area,
  };

  // ── For Sale (IDX, ungated) ──
  let forSale: SimilarForSaleCard[] = [];
  let forSaleTier: MatchTier = "none";
  try {
    const res = await getTypesenseClient()
      .collections(FORSALE_COLLECTION)
      .documents()
      .search({
        q: "*",
        query_by: "City",
        filter_by: buildForSaleSimilarFilter(subject, { lease: isLease }),
        per_page: CANDIDATE_FETCH,
        page: 1,
        include_fields: FORSALE_FIELDS,
      });
    const docs = (res.hits ?? [])
      .map((h) => h.document as Doc)
      .filter((d) => String(d.id) !== id);
    const ranked = rankSimilar<Doc>(subject, docs, forSaleAttrs, "sale", RESULT_LIMIT, {
      commercial: isCommercial,
    });
    forSale = ranked.map((r) => toForSaleCard(r, subjectDelta));
    forSaleTier = classifyMatchQuality(ranked);
  } catch (e) {
    console.error("[properties/similar] forSale", e instanceof Error ? e.message : e);
  }

  // ── Sold (VOW, gated) ──
  const { isConsumer } = await getConsumer();
  let sold: SimilarSoldCard[] = [];
  let soldTier: MatchTier = "none";
  let soldCount = 0;
  try {
    const nowMs = Date.now();
    const res = await getSoldClient()
      .collections(SOLD_LISTINGS_COLLECTION)
      .documents()
      .search({
        q: "*",
        query_by: "UnparsedAddress",
        filter_by: buildSoldSimilarFilter(subject, SOLD_WINDOW_DAYS, nowMs, { lease: isLease }),
        sort_by: "PurchaseContractDate:desc",
        per_page: CANDIDATE_FETCH,
        page: 1,
      });
    soldCount = res.found ?? 0;
    if (isConsumer) {
      const docs = (res.hits ?? [])
        .map((h) => h.document as Doc)
        .filter((d) => String(d.id) !== id);
      const ranked = rankSimilar<Doc>(subject, docs, (d) => soldAttrs(d, nowMs), "sold", RESULT_LIMIT, {
        commercial: isCommercial,
        leased: isLease,
      });
      sold = ranked.map((r) => toSoldCard(r, subjectDelta));
      soldTier = classifyMatchQuality(ranked);
    }
  } catch (e) {
    console.error("[properties/similar] sold", e instanceof Error ? e.message : e);
  }

  return NextResponse.json({
    forSale,
    sold,
    soldLocked: !isConsumer,
    soldCount,
    matchQuality: { forSale: forSaleTier, sold: soldTier },
    area: { cityRegion: subject.cityRegion, city: subject.city },
  });
}
