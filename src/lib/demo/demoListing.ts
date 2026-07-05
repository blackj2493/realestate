/**
 * Demo-listing fixtures — synthetic ListingDetail payloads used ONLY to record
 * feature demo clips of the unlocked (signed-in/VOW) experience.
 *
 * WHY: demo videos are the most public surface there is, so they can never show
 * real VOW data (sold prices, True DOM, AVM/Deal Score built on solds — §4,
 * VOW §6.2(f)). Instead of blurring or logging in, the clips drive a SYNTHETIC
 * listing: scripts/demos/make-fixture.ts takes a real listing's ListingDetail
 * (so every derived object has a real, fully-populated shape), then fabricates
 * the identity (address, photos, remarks, agents) and transforms every dollar
 * figure and date, and writes it to scripts/demos/fixtures/<PPDEMO id>.json.
 * The page renders it exactly like a real listing, ungated — nothing on screen
 * is real MLS/VOW data.
 *
 * SAFETY RAILS (all three must hold before a fixture is ever served):
 *   1. DEMO_FIXTURES=1 must be set explicitly (never in any deployed env).
 *   2. Hard-disabled on Vercel regardless of env (process.env.VERCEL).
 *   3. Only listing keys with the PPDEMO prefix resolve to fixtures — real
 *      listing keys can never be shadowed.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type { ListingDetail } from "@/lib/property/getListingDetail";

export const DEMO_LISTING_PREFIX = "PPDEMO";

export function demoFixturesEnabled(): boolean {
  return process.env.DEMO_FIXTURES === "1" && !process.env.VERCEL;
}

/** True only when demo mode is on AND the key names a synthetic listing. */
export function isDemoListingKey(listingKey: string): boolean {
  return demoFixturesEnabled() && listingKey.startsWith(DEMO_LISTING_PREFIX);
}

export async function loadDemoListingDetail(listingKey: string): Promise<ListingDetail | null> {
  if (!isDemoListingKey(listingKey)) return null;
  // Fixture ids are file names — keep them strictly alphanumeric.
  if (!/^PPDEMO[A-Za-z0-9]*$/.test(listingKey)) return null;
  try {
    const file = path.join(process.cwd(), "scripts", "demos", "fixtures", `${listingKey}.json`);
    return JSON.parse(await fs.readFile(file, "utf8")) as ListingDetail;
  } catch {
    return null;
  }
}
