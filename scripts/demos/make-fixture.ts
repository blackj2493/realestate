/**
 * make-fixture — build a synthetic PPDEMO ListingDetail fixture from a real listing.
 *
 *   npm run demo:fixture -- <SourceListingKey> [--id=PPDEMO001]
 *
 * Demo clips of the unlocked (VOW) experience must never show real VOW data, so
 * this script "sculpts" a real listing into a synthetic one that renders
 * perfectly through the real UI:
 *
 *   1. Fetch the UNGATED ListingDetail via the production data path, so every
 *      derived object (AVM, Deal Score, Value-Add, campaign/sale history) has a
 *      real, fully-populated shape.
 *   2. Scale EVERY dollar figure by one uniform factor (ratios — and therefore
 *      the Deal Score story — stay coherent) and shift every date, so no real
 *      VOW number or date survives.
 *   3. Replace the identity: address, coordinates (jittered), photos, agents,
 *      brokerage, remarks, legal description, MLS ids.
 *   4. Self-check: refuse to write if any pre-transform sensitive token (source
 *      key, address, sold prices) still appears anywhere in the output JSON.
 *
 * The fixture is served ONLY under DEMO_FIXTURES=1 on a local dev server
 * (see src/lib/demo/demoListing.ts) — it cannot ship.
 */

import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ListingDetail, SaleEvent } from "@/lib/property/getListingDetail";
import { computeExpectedSale, type CloseListRatio } from "@/lib/avm/expectedSale";

const SCALE = 0.9137; // uniform $ factor — keeps every derived ratio coherent
const DATE_SHIFT_DAYS = -37;

const FIXTURES_DIR = path.join(__dirname, "fixtures");

/** Money keys by exact name (shapes where the name alone isn't self-describing). */
const MONEY_EXACT = new Set([
  "low",
  "high",
  "lowBand",
  "highBand",
  "estimatedValue",
  "expectedPrice",
  "closePrice",
  "listPrice",
  "lastClosePrice",
  "predictiveSD",
]);
const MONEY_RE = /(price|value|amount|fee|tax|cost|rent|assessment|deposit|income|expense|band)/i;
const NOT_MONEY_RE =
  /(pct|percent|ratio|rate|score|confidence|dom|days|count|year|built|sqft|area|frontage|depth|lat|lon|bed|bath|room|kitchen|parking|garage|stor|level|range|unit)/i;
const DATE_RE = /(date|timestamp)/i;

function isMoneyKey(key: string): boolean {
  return MONEY_EXACT.has(key) || (MONEY_RE.test(key) && !NOT_MONEY_RE.test(key));
}

function smartRound(v: number): number {
  const a = Math.abs(v);
  if (a >= 100_000) return Math.round(v / 1000) * 1000;
  if (a >= 2_000) return Math.round(v / 50) * 50;
  if (a >= 100) return Math.round(v);
  return Math.round(v * 100) / 100;
}

function shiftDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  d.setUTCDate(d.getUTCDate() + DATE_SHIFT_DAYS);
  // Preserve the source granularity: date-only stays date-only.
  return value.length <= 10 ? d.toISOString().slice(0, 10) : d.toISOString();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface TransformCtx {
  /** Case-insensitive text replacements applied to EVERY string field. */
  swaps: Array<{ re: RegExp; to: string }>;
  /** Dollar figures that must be scaled no matter which key carries them. */
  sensitiveNumbers: Set<number>;
}

/**
 * Recursively transform: scale money (by key OR by known-sensitive value),
 * shift dates, and apply the identity text swaps to every string.
 */
function transform(node: unknown, ctx: TransformCtx): unknown {
  if (Array.isArray(node)) return node.map((x) => transform(x, ctx));
  if (node !== null && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(node as Record<string, unknown>)) {
      let v: unknown = raw;
      if (typeof v === "number" && Number.isFinite(v)) {
        if (isMoneyKey(key) || ctx.sensitiveNumbers.has(Math.round(v))) {
          v = smartRound(v * SCALE);
        }
      } else if (typeof v === "string") {
        if (DATE_RE.test(key)) {
          v = shiftDate(v);
        } else {
          for (const { re, to } of ctx.swaps) v = (v as string).replace(re, to);
        }
      } else {
        v = transform(v, ctx);
      }
      out[key] = v;
    }
    return out;
  }
  return node;
}

const DEMO_PHOTOS = [
  "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=1600&q=80",
  "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1600&q=80",
  "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=1600&q=80",
  "https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?auto=format&fit=crop&w=1600&q=80",
  "https://images.unsplash.com/photo-1600585154526-990dced4db0d?auto=format&fit=crop&w=1600&q=80",
  "https://images.unsplash.com/photo-1600607687920-4e2a09cf159d?auto=format&fit=crop&w=1600&q=80",
];

const DEMO_REMARKS =
  "Tucked onto a quiet, tree-lined crescent, this bright and meticulously kept home pairs a " +
  "renovated open-concept main floor with a light-filled second storey and a private, fully " +
  "fenced yard. Wide-plank flooring, a quartz waterfall island and floor-to-ceiling windows " +
  "anchor the living space; downstairs, a finished lower level adds a rec room and rough-in " +
  "for a future suite. Steps to parks, top-rated schools and the GO. (Demonstration listing " +
  "— all data on this page is synthetic.)";

function scrubIdentity(fx: ListingDetail, demoId: string): void {
  const p = fx.full_payload as Record<string, unknown>;

  fx.listing_key = demoId;
  p.ListingKey = demoId;
  p.ListingId = demoId;

  const isUnit = p.UnitNumber != null && String(p.UnitNumber).trim() !== "";
  p.StreetNumber = "128";
  p.StreetName = "Maplecrest";
  p.StreetSuffix = "Avenue";
  delete p.StreetDirPrefix;
  delete p.StreetDirSuffix;
  if (isUnit) p.UnitNumber = "1208";
  p.UnparsedAddress = `${isUnit ? "1208 - " : ""}128 Maplecrest Avenue`;
  p.CrossStreet = "Maplecrest Ave & Orchard Grove";
  p.PostalCode = "L5L 0K4";
  p.TaxLegalDescription = "LOT 128, PLAN 20M-0000 (DEMO)";
  p.PublicRemarks = DEMO_REMARKS;

  // Jitter coordinates ~400m so the pin doesn't sit on the source property.
  if (typeof p.Latitude === "number") p.Latitude = (p.Latitude as number) + 0.0037;
  if (typeof p.Longitude === "number") p.Longitude = (p.Longitude as number) - 0.0049;

  // Agents / brokerage / contact / tour / media fields — blanket scrub by key.
  for (const key of Object.keys(p)) {
    const v = p[key];
    if (/(privateremarks|virtualtour)/i.test(key)) {
      delete p[key];
    } else if (/(phone|fax|email)/i.test(key) && typeof v === "string") {
      p[key] = "";
    } else if (/(agent|broker)/i.test(key) && /name/i.test(key) && typeof v === "string" && v) {
      p[key] = "Alex Morgan";
    } else if (/office/i.test(key) && /name/i.test(key) && typeof v === "string" && v) {
      p[key] = "Demo Realty Group";
    } else if (/(media|image|photo)/i.test(key)) {
      delete p[key];
    }
  }

  fx.media_urls = [...DEMO_PHOTOS];
}

/** Ensure the demo tells the full story: prior sales must exist for the ledger demo. */
function ensureSaleHistory(fx: ListingDetail, demoId: string): void {
  const p = fx.full_payload as Record<string, unknown>;
  const lp = typeof p.ListPrice === "number" ? (p.ListPrice as number) : 1_000_000;
  const subType = typeof p.PropertySubType === "string" ? (p.PropertySubType as string) : null;

  if (fx.saleHistory.available && fx.saleHistory.events.length > 0) {
    // Real (already money/date-transformed) history — just re-key the events.
    fx.saleHistory.events = fx.saleHistory.events.map((e, i) => ({
      ...e,
      listing_key: `${demoId}S${i + 1}`,
    }));
    return;
  }

  const yearNow = new Date().getUTCFullYear();
  const mk = (yearsAgo: number, listF: number, closeF: number, i: number): SaleEvent => ({
    listing_key: `${demoId}S${i}`,
    list_price: smartRound(lp * listF),
    close_price: smartRound(lp * closeF),
    contract_date: `${yearNow - yearsAgo}-04-18`,
    close_date: `${yearNow - yearsAgo}-06-02`,
    sub_type: subType,
  });
  const events = [mk(3, 0.8, 0.815, 2), mk(7, 0.6, 0.63, 1)];
  fx.saleHistory = {
    available: true,
    saleCount: 2,
    events,
    lastClosePrice: events[0].close_price,
    lastCloseDate: events[0].close_date,
  };
}

/** Plausible per-room dimensions (meters, TRREB convention) so the Drawn-to-Scale
 *  Room Map renders when the source listing had no stored rooms. */
function ensureRooms(fx: ListingDetail, demoId: string): void {
  if (fx.rooms.length > 0) return;
  const mk = (i: number, type: string, level: string, l: number, w: number) => ({
    RoomKey: `${demoId}R${i}`,
    RoomType: type,
    RoomLevel: level,
    RoomLength: l,
    RoomWidth: w,
    RoomDimensions: `${l} m x ${w} m`,
    RoomFeatures: undefined,
  });
  fx.rooms = [
    mk(1, "Living Room", "Main", 6.1, 3.9),
    mk(2, "Dining Room", "Main", 4.2, 3.4),
    mk(3, "Kitchen", "Main", 4.9, 3.7),
    mk(4, "Family Room", "Main", 5.2, 3.9),
    mk(5, "Primary Bedroom", "Second", 5.5, 4.1),
    mk(6, "Bedroom 2", "Second", 4.0, 3.3),
    mk(7, "Bedroom 3", "Second", 3.8, 3.2),
    mk(8, "Bedroom 4", "Second", 3.6, 3.1),
    mk(9, "Recreation Room", "Basement", 7.3, 4.6),
  ];
}

/**
 * Pin True DOM to a believable demo value. The source listing's stitched DOM can
 * be huge (long relist chains) which reads badly in a hero clip; 41 days matches
 * the "Listed 41 days ago" the −37-day date shift produces for a fresh listing.
 */
function normalizeTrueDom(fx: ListingDetail): void {
  const dom = 41;
  const p = fx.full_payload as Record<string, unknown>;
  p.true_dom = dom;
  if (typeof p.DaysOnMarket === "number") p.DaysOnMarket = dom;
  fx.priceTimeline.trueDom = dom;
  fx.campaignHistory.trueDom = dom;
}

/** Rebuild expectedSale coherently from the transformed list price. */
function rebuildExpectedSale(fx: ListingDetail): void {
  const p = fx.full_payload as Record<string, unknown>;
  const lp = typeof p.ListPrice === "number" ? (p.ListPrice as number) : null;
  if (!lp) return;
  const ratio: CloseListRatio = fx.expectedSale
    ? {
        ratio: fx.expectedSale.ratio,
        sampleSize: fx.expectedSale.sampleSize,
        windowMonths: fx.expectedSale.windowMonths,
        scope: fx.expectedSale.scope,
      }
    : { ratio: 0.978, sampleSize: 214, windowMonths: 6, scope: "cohort" };
  fx.expectedSale = computeExpectedSale(lp, ratio);
}

/** Every dollar figure that is (or is derived from) VOW data on this listing. */
function sensitivePrices(detail: ListingDetail): number[] {
  const out: Array<number | null | undefined> = [
    detail.saleHistory.lastClosePrice,
    ...detail.saleHistory.events.flatMap((e) => [e.close_price, e.list_price]),
    detail.status.kind === "sold" ? detail.status.closePrice : null,
    detail.estimate?.estimatedValue,
    detail.expectedSale?.expectedPrice,
    detail.priceTimeline.originalPrice,
  ];
  return out.filter((v): v is number => typeof v === "number" && v > 10_000).map((v) => Math.round(v));
}

/** Identity strings from the source listing (checked case-insensitively). */
function identityTokens(detail: ListingDetail): string[] {
  const p = detail.full_payload as Record<string, unknown>;
  const tokens: string[] = [detail.listing_key];
  const streetNumber = typeof p.StreetNumber === "string" ? (p.StreetNumber as string).trim() : "";
  const streetName = typeof p.StreetName === "string" ? (p.StreetName as string).trim() : "";
  if (streetName.length > 2) tokens.push(streetName);
  if (streetNumber && streetName) tokens.push(`${streetNumber} ${streetName}`);
  if (typeof p.UnparsedAddress === "string" && (p.UnparsedAddress as string).length > 3) {
    tokens.push(p.UnparsedAddress as string);
  }
  // Parcel/roll/legal identifiers — wherever they hide, they identify the property.
  for (const [key, v] of Object.entries(p)) {
    if (/(legal|roll|parcel|arn)/i.test(key) && typeof v === "string" && v.trim().length > 5) {
      tokens.push(v.trim());
    }
  }
  return tokens;
}

/** Pre-transform tokens that must NOT survive into the fixture (all variants). */
function leakTokens(detail: ListingDetail): string[] {
  const tokens = [...identityTokens(detail)];
  for (const v of sensitivePrices(detail)) {
    tokens.push(String(v), v.toLocaleString("en-US")); // 1499107 and 1,499,107
  }
  return tokens;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const srcKey = argv.find((a) => !a.startsWith("--"));
  const demoId = argv.find((a) => a.startsWith("--id="))?.slice(5) || "PPDEMO001";
  if (!srcKey) {
    console.error("Usage: npm run demo:fixture -- <SourceListingKey> [--id=PPDEMO001]");
    process.exit(1);
  }
  if (!/^PPDEMO[A-Za-z0-9]*$/.test(demoId)) {
    console.error(`--id must match PPDEMO[A-Za-z0-9]* (got "${demoId}")`);
    process.exit(1);
  }

  // Deferred import: pulls in the full server data path (Supabase, AVM, ProptX).
  const { getListingDetail } = await import("@/lib/property/getListingDetail");
  console.log(`Fetching ungated detail for ${srcKey} …`);
  const detail = await getListingDetail(srcKey);
  if (!detail) {
    console.error(`Listing ${srcKey} not found in the listings table.`);
    process.exit(1);
  }
  const tokens = leakTokens(detail);

  // Text swaps: longest tokens first so "150 Cannes Avenue…" wins over "Cannes".
  const p0 = detail.full_payload as Record<string, unknown>;
  const isUnit0 = p0.UnitNumber != null && String(p0.UnitNumber).trim() !== "";
  const demoAddress = `${isUnit0 ? "1208 - " : ""}128 Maplecrest Avenue`;
  const streetName0 = typeof p0.StreetName === "string" ? (p0.StreetName as string).trim() : "";
  const swaps = identityTokens(detail)
    .sort((a, b) => b.length - a.length)
    .map((t) => ({
      re: new RegExp(escapeRe(t), "gi"),
      to:
        t === detail.listing_key
          ? demoId
          : t === streetName0
            ? "Maplecrest"
            : /^[\d\s.-]+$/.test(t)
              ? "000-000-000"
              : demoAddress,
    }));
  // Sensitive dollar figures can also appear FORMATTED inside narrative strings
  // ("…estimate of $1,499,107…") — swap those to their scaled equivalents too.
  for (const v of sensitivePrices(detail)) {
    const scaled = smartRound(v * SCALE);
    swaps.push(
      { re: new RegExp(escapeRe(v.toLocaleString("en-US")), "g"), to: scaled.toLocaleString("en-US") },
      { re: new RegExp(`(?<![\\d,])${escapeRe(String(v))}(?![\\d,])`, "g"), to: String(scaled) }
    );
  }
  const ctx: TransformCtx = { swaps, sensitiveNumbers: new Set(sensitivePrices(detail)) };

  const fx = transform(detail, ctx) as ListingDetail;
  scrubIdentity(fx, demoId);
  ensureSaleHistory(fx, demoId);
  ensureRooms(fx, demoId);
  normalizeTrueDom(fx);
  rebuildExpectedSale(fx);

  const json = JSON.stringify(fx, null, 2);
  const jsonLower = json.toLowerCase();
  const leaked = tokens.filter((t) => jsonLower.includes(t.toLowerCase()));
  if (leaked.length > 0) {
    console.error("REFUSING to write fixture — sensitive tokens survived the transform:");
    for (const t of leaked) console.error(`  • ${t}`);
    process.exit(1);
  }

  mkdirSync(FIXTURES_DIR, { recursive: true });
  const file = path.join(FIXTURES_DIR, `${demoId}.json`);
  writeFileSync(file, json, "utf8");
  console.log(`Wrote ${file}`);
  console.log(
    `  estimate=${fx.estimate ? "yes" : "MISSING"} valueAdd=${fx.valueAdd ? "yes" : "MISSING"} ` +
      `dealScore=${fx.dealScore.score ?? "MISSING"} saleEvents=${fx.saleHistory.events.length} ` +
      `campaignEvents=${fx.campaignHistory.events.length} rooms=${fx.rooms.length}`
  );
  console.log(`\nServe it: DEMO_FIXTURES=1 npm run dev → /properties/${demoId}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
