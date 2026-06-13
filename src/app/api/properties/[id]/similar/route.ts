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
  type SubjectAttrs,
  type CandidateAttrs,
  type MatchTier,
  type RankedSimilar,
} from "@/lib/property/similarListings";

export const dynamic = "force-dynamic";

const FORSALE_COLLECTION = "properties";
const CANDIDATE_FETCH = 80;
const RESULT_LIMIT = 8;
const SOLD_WINDOW_DAYS = 180;
const FORSALE_FIELDS =
  "id,ListPrice,UnparsedAddress,City,CityRegion,PropertySubType,BedroomsTotal,BathroomsTotalInteger,ParkingTotal,ListOfficeName,primaryImageUrl,RawImages,calculatedDOM";

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
  baths: number;
  propertySubType: string | null;
  brokerage: string | null;
  thumb: string | null;
  daysOnMarket: number | null;
  why: string;
}

export interface SimilarSoldCard {
  id: string;
  address: string;
  city: string | null;
  closePrice: number;
  listPrice: number | null;
  soldDate: string | null;
  beds: number | null;
  baths: number | null;
  propertySubType: string | null;
  brokerage: string | null;
  thumb: string | null;
  pctOfAsk: number | null;
  why: string;
}

type Doc = Record<string, unknown>;
const numField = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);

function forSaleAttrs(d: Doc): CandidateAttrs {
  return {
    cityRegion: (d.CityRegion as string) || null,
    subType: (d.PropertySubType as string) || null,
    beds: numField(d.BedroomsTotal),
    price: numField(d.ListPrice),
    area: 0, // BuildingAreaTotal is not reliably present on the active index → neutral
  };
}

function soldAttrs(d: Doc, nowMs: number): CandidateAttrs {
  const ms = Number(d.PurchaseContractDate);
  const daysAgo = Number.isFinite(ms) && ms > 0 ? (nowMs - ms) / 86_400_000 : 999;
  return {
    cityRegion: (d.CityRegion as string) || null,
    subType: (d.PropertySubType as string) || null,
    beds: numField(d.BedroomsTotal),
    price: numField(d.ClosePrice),
    area: numField(d.BuildingAreaTotal),
    daysAgo,
  };
}

function toForSaleCard(r: RankedSimilar<Doc>): SimilarForSaleCard {
  const d = r.item;
  const imgs = Array.isArray(d.RawImages) ? (d.RawImages as string[]) : [];
  return {
    id: String(d.id),
    address: (d.UnparsedAddress as string) || "",
    city: (d.City as string) || null,
    price: numField(d.ListPrice),
    beds: numField(d.BedroomsTotal),
    baths: numField(d.BathroomsTotalInteger),
    propertySubType: (d.PropertySubType as string) || null,
    brokerage: (d.ListOfficeName as string) || null,
    thumb: (d.primaryImageUrl as string) || imgs[0] || null,
    daysOnMarket: Number.isFinite(Number(d.calculatedDOM)) ? Number(d.calculatedDOM) : null,
    why: r.why,
  };
}

function toSoldCard(r: RankedSimilar<Doc>): SimilarSoldCard {
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
    baths: m.baths,
    propertySubType: m.propertySubType,
    brokerage: m.brokerage,
    thumb: m.primaryImageUrl,
    pctOfAsk,
    why: r.why,
  };
}

const numParam = (v: string | null): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sp = new URL(req.url).searchParams;
  const subject: SubjectAttrs = {
    id,
    cityRegion: (sp.get("cityRegion") || "").trim() || null,
    city: (sp.get("city") || "").trim() || null,
    subType: (sp.get("subType") || "").trim() || null,
    beds: numParam(sp.get("beds")),
    listPrice: numParam(sp.get("listPrice")),
    area: numParam(sp.get("area")),
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
        filter_by: buildForSaleSimilarFilter(subject),
        per_page: CANDIDATE_FETCH,
        page: 1,
        include_fields: FORSALE_FIELDS,
      });
    const docs = (res.hits ?? [])
      .map((h) => h.document as Doc)
      .filter((d) => String(d.id) !== id);
    const ranked = rankSimilar<Doc>(subject, docs, forSaleAttrs, "sale", RESULT_LIMIT);
    forSale = ranked.map(toForSaleCard);
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
        filter_by: buildSoldSimilarFilter(subject, SOLD_WINDOW_DAYS, nowMs),
        sort_by: "PurchaseContractDate:desc",
        per_page: CANDIDATE_FETCH,
        page: 1,
      });
    soldCount = res.found ?? 0;
    if (isConsumer) {
      const docs = (res.hits ?? [])
        .map((h) => h.document as Doc)
        .filter((d) => String(d.id) !== id);
      const ranked = rankSimilar<Doc>(subject, docs, (d) => soldAttrs(d, nowMs), "sold", RESULT_LIMIT);
      sold = ranked.map(toSoldCard);
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
