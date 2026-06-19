/**
 * Batch "Estimated Sale Price" for command-center search rows. The command center is
 * Typesense-only and the sale price is VOW-derived (close/list ratio from raw_vow_sold +
 * the AVM), so rows can't compute it client-side. This endpoint resolves the SAME single
 * number the listing page shows, for many rows at once:
 *
 *   • close/list ratio per cohort via getCloseListRatio (unstable_cache'd 24h) — deduped
 *     to the distinct (city × sub-type) cohorts in the batch, so a 100-row page does only
 *     a handful of cached lookups.
 *   • AVM fallback from property_estimates in ONE batched PK read.
 *   • resolveSalePrice() picks the headline (list-anchored where we can, AVM otherwise).
 *
 * VOW gate: authed only — anonymous callers get {} (no VOW-derived numbers reach them).
 * Deterministic, no AI (§4). The client passes public IDX fields (id/list/city/type) it
 * already holds from Typesense; only the resolved number is returned.
 */
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/server";
import { getServiceRoleClient } from "@/lib/supabase/client";
import { getCloseListRatio } from "@/lib/property/getCloseListRatio";
import { computeExpectedSale, type CloseListRatio } from "@/lib/avm/expectedSale";
import { resolveSalePrice, type SalePriceEstimate } from "@/lib/avm/salePrice";
import type { AVMResult } from "@/lib/avm/types";

export const dynamic = "force-dynamic";

interface Item {
  id: string;
  listPrice?: number | null;
  city?: string | null;
  propertySubType?: string | null;
}

const MAX_ITEMS = 120; // matches the 100-listing display cap with headroom

export async function POST(req: NextRequest) {
  let items: Item[] = [];
  try {
    const body = await req.json();
    if (Array.isArray(body?.items)) items = body.items.slice(0, MAX_ITEMS);
  } catch {
    /* empty / malformed body → no items */
  }
  if (items.length === 0) return NextResponse.json({ salePrices: {} });

  // VOW gate: the ratio + AVM are VOW-derived → authed only.
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ salePrices: {} });

  const ids = items.map((i) => i.id).filter(Boolean);

  // AVM fallback values — one batched PK read on the nightly-precomputed table.
  const avmById = new Map<string, { estimatedValue: number; confidence: AVMResult["confidence"] }>();
  try {
    const sb = getServiceRoleClient();
    const { data } = await sb
      .from("property_estimates")
      .select("listing_key, estimated_value, confidence")
      .in("listing_key", ids);
    for (const r of data ?? []) {
      const v = r.estimated_value != null ? Number(r.estimated_value) : 0;
      if (v > 0) {
        const c = r.confidence as AVMResult["confidence"] | null;
        avmById.set(r.listing_key as string, {
          estimatedValue: v,
          confidence: c === "HIGH" || c === "MEDIUM" || c === "LOW" ? c : "LOW",
        });
      }
    }
  } catch {
    /* estimate is additive — never let a missing table break the batch */
  }

  // Dedupe cohort ratio lookups to the distinct (city × sub-type) pairs, resolved once.
  const cohortKey = (c?: string | null, s?: string | null) =>
    `${(c ?? "").trim().toLowerCase()}|${(s ?? "").trim().toLowerCase()}`;
  const cohorts = new Map<string, { city: string | null; sub: string | null }>();
  for (const it of items) {
    if (it.listPrice && it.listPrice > 0) {
      cohorts.set(cohortKey(it.city, it.propertySubType), {
        city: it.city ?? null,
        sub: it.propertySubType ?? null,
      });
    }
  }
  const ratioByCohort = new Map<string, CloseListRatio | null>();
  await Promise.all(
    [...cohorts].map(async ([k, c]) => {
      try {
        ratioByCohort.set(k, await getCloseListRatio(c.city, c.sub));
      } catch {
        ratioByCohort.set(k, null);
      }
    })
  );

  const out: Record<string, SalePriceEstimate | null> = {};
  for (const it of items) {
    const listPrice = typeof it.listPrice === "number" && it.listPrice > 0 ? it.listPrice : null;
    const ratio = listPrice ? ratioByCohort.get(cohortKey(it.city, it.propertySubType)) ?? null : null;
    const expectedSale = listPrice ? computeExpectedSale(listPrice, ratio) : null;
    const a = avmById.get(it.id);
    const avmShim: AVMResult | null = a
      ? ({
          estimatedValue: a.estimatedValue,
          anchorPrice: a.estimatedValue,
          lowBand: 0,
          highBand: 0,
          confidence: a.confidence,
        } as AVMResult)
      : null;
    out[it.id] = resolveSalePrice({ listPrice, isActive: true, expectedSale, estimate: avmShim });
  }

  return NextResponse.json({ salePrices: out });
}
