/**
 * Onboarding-email data layer (engagement build plan 1.4 / §174).
 *
 * Shapes the LIVE OnboardingAreaData the 2B "add your first area" email renders — the
 * same board queries the dashboard runs (fetchBoard) + IDX-safe aggregate counts, mapped
 * to the pure renderer's row shape. Kept separate from the renderer (which stays pure &
 * testable) exactly like digest.ts vs the alerts worker.
 *
 * Compliance: active-listing rows + aggregate new/active counts are IDX-safe; every row
 * carries the listing brokerage (mapped through to the renderer). No sold prices.
 *
 * Runtime: fetchBoard → searchListings uses the search-only Typesense key
 * (NEXT_PUBLIC_TYPESENSE_SEARCH_ONLY_API_KEY) — set it in the worker's env (see
 * daily-sync.yml) so this runs in the tsx cron, not just a Next server route.
 */

import { BOARDS, DEFAULT_BOARD_ORDER, type BoardDef, type BoardId } from "@/lib/dashboard/boards";
import { fetchBoard, fetchNewCount, fetchNewListings, fetchRegionStats } from "@/lib/dashboard/queries";
import { regionArea } from "@/lib/dashboard/area";
import { DEFAULT_ACTIVITY_LENS } from "@/lib/dashboard/config";
import { formatRegionLabel } from "@/lib/regions/formatRegionLabel";
import type { ListingDocument } from "@/lib/typesense/client";
import type { OnboardingAreaData, OnboardingListingRow, SaveHomeListing } from "./onboardingEmails";

/** The representative area 2B shows when the recipient has no saved area of their own. */
export const EXAMPLE_REGION = "Woodbridge";

function mapRow(l: ListingDocument, board: BoardDef): OnboardingListingRow {
  const addr = l.UnparsedAddress?.trim() || l.City || "Address unavailable";
  return {
    listing_key: l.id,
    address: addr,
    city: l.City ?? null,
    price: typeof l.ListPrice === "number" ? l.ListPrice : null,
    thumb: l.thumbnailUrl || l.primaryImageUrl || null,
    brokerage: l.ListOfficeName ?? null,
    boardTitle: board.title,
    metricLabel: board.metricLabel,
    metricValue: board.formatMetric(l[board.metricField] as number | undefined),
  };
}

/**
 * Build the live OnboardingAreaData for a region: the top listing of each board (deduped
 * so no listing appears twice) plus aggregate new/active counts. Best-effort — a thin or
 * empty area, or a single failed board, just yields fewer rows / null counts, never a throw.
 */
export async function buildAreaData(region: string): Promise<OnboardingAreaData> {
  const area = regionArea(region);
  const lens = DEFAULT_ACTIVITY_LENS;
  const boardIds: BoardId[] = DEFAULT_BOARD_ORDER;

  const [rowsSettled, newCount, stats] = await Promise.all([
    Promise.allSettled(boardIds.map((id) => fetchBoard(BOARDS[id], area, lens, 1))),
    fetchNewCount(area, lens).catch(() => null),
    fetchRegionStats(area, lens).catch(() => null),
  ]);

  const rows: OnboardingListingRow[] = [];
  const seen = new Set<string>();
  rowsSettled.forEach((res, i) => {
    if (res.status !== "fulfilled") return;
    const top = res.value[0];
    if (!top || seen.has(top.id)) return; // dedupe: one listing, one board
    seen.add(top.id);
    rows.push(mapRow(top, BOARDS[boardIds[i]]));
  });

  return {
    areaName: formatRegionLabel(region),
    newCount,
    activeCount: stats?.activeCount ?? null,
    rows,
  };
}

/** 2B's example area (Woodbridge), fully swallowed on failure so the email still sends. */
export async function buildExampleAreaData(): Promise<OnboardingAreaData | null> {
  try {
    return await buildAreaData(EXAMPLE_REGION);
  } catch (e) {
    console.warn("[onboarding] example area fetch failed:", e);
    return null;
  }
}

/**
 * Real "homes worth saving" for email #3 — newest active listings in a region, mapped to
 * plain rows (real MLS photo when present, clean gray fallback otherwise). Best-effort:
 * a thin/empty area or a fetch error yields [], so #3 degrades to its no-homes layout.
 */
export async function buildSaveHomeListings(region: string, limit = 3): Promise<SaveHomeListing[]> {
  try {
    const listings = await fetchNewListings(regionArea(region), DEFAULT_ACTIVITY_LENS, limit);
    return listings.map((l) => ({
      listing_key: l.id,
      address: l.UnparsedAddress?.trim() || l.City || "Address unavailable",
      city: l.City ?? null,
      price: typeof l.ListPrice === "number" ? l.ListPrice : null,
      thumb: l.thumbnailUrl || l.primaryImageUrl || null,
      brokerage: l.ListOfficeName ?? null,
    }));
  } catch (e) {
    console.warn("[onboarding] save-home listings fetch failed:", e);
    return [];
  }
}
